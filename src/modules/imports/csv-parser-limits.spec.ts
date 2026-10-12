import {
  CSV_HEADER,
  CSV_MAX_BYTES,
  CSV_MAX_ENTRIES,
  CSV_MAX_SETS,
} from '../../schemas/csv-import.schema';
import { parseWorkoutCsv } from './csv-parser';

const date = '2024-02-29T12:00:00Z';
const row = (ref: string, position = 1, name = 'Squat') =>
  `${ref},${date},${name},${position},10000,0,kg\n`;
async function count(source: Buffer) {
  let entries = 0;
  let sets = 0;
  let record = 0;
  for await (const item of parseWorkoutCsv(source)) {
    entries++;
    sets += item.entry.sets.length;
    record = item.record;
  }
  return { entries, sets, record };
}
function dataset(entries: number, sets: number): Buffer {
  const groups = Array.from({ length: entries }, (_, i) =>
    Array.from({ length: sets }, (_, j) => row(`r${i}`, j + 1)).join(''),
  );
  return Buffer.from(`${CSV_HEADER}\n${groups.join('')}`);
}

describe('CSV limits and bounded streaming', () => {
  it('exports the upload contract limits', () => {
    expect([CSV_MAX_BYTES, CSV_MAX_ENTRIES, CSV_MAX_SETS]).toEqual([
      33554432, 50000, 150000,
    ]);
    expect(CSV_HEADER).toBe(
      'entryRef,date,exerciseName,setPosition,reps,weight,unit',
    );
  });
  it('accepts exactly 50,000 entries / 150,000 sets without collecting output', async () => {
    expect(await count(dataset(50000, 3))).toEqual({
      entries: 50000,
      sets: 150000,
      record: 149998,
    });
  }, 30000);
  it('rejects entry 50,001 at its first data record', async () => {
    await expect(count(dataset(50001, 1))).rejects.toMatchObject({
      code: 'CSV_TOO_MANY_ENTRIES',
      record: 50001,
      field: 'entryRef',
    });
  }, 30000);
  it('rejects set 150,001 across otherwise valid 100-set groups', async () => {
    const source = Buffer.concat([
      dataset(1500, 100),
      Buffer.from(row('last')),
    ]);
    await expect(count(source)).rejects.toMatchObject({
      code: 'CSV_TOO_MANY_SETS',
      record: 150001,
      field: null,
    });
  }, 30000);
  it('accepts 100 positions and rejects position 101', async () => {
    const source = dataset(1, 100);
    expect(await count(source)).toEqual({ entries: 1, sets: 100, record: 1 });
    await expect(
      count(Buffer.concat([source, Buffer.from(row('r0', 101))])),
    ).rejects.toMatchObject({
      code: 'CSV_INVALID_VALUE',
      record: 101,
      field: 'setPosition',
    });
  });
  it('applies the byte limit before parsing, allowing exactly 32 MiB to reach parsing', async () => {
    const source = Buffer.alloc(CSV_MAX_BYTES + 1, 'x');
    await expect(count(source)).rejects.toMatchObject({
      code: 'CSV_TOO_LARGE',
      record: null,
      field: null,
    });
    await expect(
      count(source.subarray(0, CSV_MAX_BYTES)),
    ).rejects.toMatchObject({
      code: 'CSV_RECORD_TOO_LARGE',
      record: null,
    });
  });
  it('rejects an oversized logical record even with quoted physical newlines', async () => {
    const source = Buffer.from(
      `${CSV_HEADER}\n${row('a')}b,${date},"${' \n'.repeat(33000)}Squat",1,1,0,kg`,
    );
    await expect(count(source)).rejects.toMatchObject({
      code: 'CSV_RECORD_TOO_LARGE',
      record: 2,
      field: 'exerciseName',
    });
  });
  it('handles UTF-8 and escaped quotes split across input chunks', async () => {
    const prefix = `${CSV_HEADER}\na,${date},"`;
    const padding = ' '.repeat(16383 - Buffer.byteLength(prefix));
    const source = Buffer.from(
      `${prefix}${padding}é ""wide""\r\nSquat",1,1,0,kg`,
    );
    expect(source[16383]).toBe(0xc3);
    expect(source[16384]).toBe(0xa9);
    expect(await count(source)).toEqual({ entries: 1, sets: 1, record: 1 });
  });
  it('accepts the longest entry reference', async () => {
    expect(
      await count(Buffer.from(`${CSV_HEADER}\n${row('a'.repeat(128))}`)),
    ).toEqual({
      entries: 1,
      sets: 1,
      record: 1,
    });
  });
  it('bounds delimiter-heavy rows before accumulating their fields', async () => {
    const source = Buffer.from(`${CSV_HEADER}\n${','.repeat(100000)}`);
    await expect(count(source)).rejects.toMatchObject({
      code: 'CSV_INVALID_COLUMNS',
      record: 1,
      field: null,
    });
  });
  it.each([0, 1, 10])(
    'enforces exactly 64 KiB after %i earlier records',
    async (earlier) => {
      const prefix = `a,${date},"`;
      const suffix = 'Squat",1,1,0,kg';
      const padding = ' '.repeat(65536 - Buffer.byteLength(prefix + suffix));
      const before =
        CSV_HEADER +
        '\n' +
        Array.from({ length: earlier }, (_, i) => row(`before${i}`)).join('');
      const source = Buffer.from(`${before}${prefix}${padding}${suffix}`);
      expect(await count(source)).toEqual({
        entries: earlier + 1,
        sets: earlier + 1,
        record: earlier + 1,
      });
      await expect(
        count(Buffer.from(`${before}${prefix} ${padding}${suffix}`)),
      ).rejects.toMatchObject({
        code: 'CSV_RECORD_TOO_LARGE',
        record: earlier + 1,
        field: 'unit',
      });
    },
  );
  it('releases streams when the consumer stops early', async () => {
    const iterator = parseWorkoutCsv(dataset(2000, 1));
    expect((await iterator.next()).value?.entryRef).toBe('r0');
    expect(await iterator.return(undefined)).toEqual({
      value: undefined,
      done: true,
    });
  });
});
