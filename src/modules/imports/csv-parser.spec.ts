import type { CreateWorkoutDto } from '../../schemas/workout.schema';
import { CSV_HEADER } from '../../schemas/csv-import.schema';
import { CsvImportError, parseWorkoutCsv } from './csv-parser';

const date = '2024-02-29T12:00:00Z';
const base = ['a', date, 'Bench Press', '1', '5', '135', 'lb'];
const encode = (cells: string[]) =>
  cells.map((value) => `"${value.replaceAll('"', '""')}"`).join(',');
const row = (index: number, value: string) =>
  encode(base.map((cell, i) => (i === index ? value : cell)));
async function read(csv: string | Buffer) {
  const entries: {
    entryRef: string;
    record: number;
    entry: CreateWorkoutDto;
  }[] = [];
  for await (const entry of parseWorkoutCsv(
    Buffer.isBuffer(csv) ? csv : Buffer.from(csv),
  ))
    entries.push(entry);
  return entries;
}
async function invalid(
  csv: string | Buffer,
  code: string,
  record: number | null,
  field: string | null = null,
) {
  await expect(read(csv)).rejects.toMatchObject({
    name: 'CsvImportError',
    message: 'Invalid workout CSV',
    code,
    record,
    field,
  });
}

describe('strict workout CSV', () => {
  it.each(['\n', '\r\n'])(
    'accepts BOM, quoted cells and %j records',
    async (eol) => {
      const name = ' Press, "wide"\nĐẩy 🏋️ ';
      const rows = [
        row(2, name),
        encode(['a', date, name, '2', '1', '0.000001', 'kg']),
        row(0, 'b'),
      ];
      const parsed = await read(
        `\ufeff${CSV_HEADER}${eol}${rows.join(eol)}${eol}`,
      );
      expect(parsed).toEqual([
        {
          entryRef: 'a',
          record: 1,
          entry: {
            date,
            exerciseName: name,
            sets: [
              { reps: 5, weight: 135, unit: 'lb' },
              { reps: 1, weight: 0.000001, unit: 'kg' },
            ],
          },
        },
        {
          entryRef: 'b',
          record: 3,
          entry: {
            date,
            exerciseName: 'Bench Press',
            sets: [{ reps: 5, weight: 135, unit: 'lb' }],
          },
        },
      ]);
    },
  );
  it('accepts quoted headers, mixed line endings and no final newline', async () => {
    expect(
      await read(
        `${encode(CSV_HEADER.split(','))}\r\n${base.join(',')}\n${row(0, 'B_-9')}`,
      ),
    ).toHaveLength(2);
  });
  it.each(['', '\ufeff', CSV_HEADER, `${CSV_HEADER}\n`])(
    'rejects empty input %#',
    async (csv) => {
      await invalid(csv, 'CSV_EMPTY', null);
    },
  );
  it.each([
    `${CSV_HEADER},extra`,
    CSV_HEADER.replace('unit', 'reps'),
    CSV_HEADER.replace('entryRef,date', 'date,entryRef'),
    CSV_HEADER.replace('entryRef', 'EntryRef'),
    CSV_HEADER.replace('date', ' date'),
    CSV_HEADER.replace(',unit', ''),
    '',
  ])('rejects incorrect headers %#', async (header) => {
    await invalid(`${header}\n${base.join(',')}`, 'CSV_INVALID_HEADER', null);
  });
  it.each(['', ' ', 'a,b', `${base.join(',')},extra`, `${base.join(',')},`])(
    'rejects malformed row width %#',
    async (value) => {
      await invalid(
        `${CSV_HEADER}\n${base.join(',')}\n${value}\n`,
        'CSV_INVALID_COLUMNS',
        2,
      );
    },
  );
  it.each([1, 2])('requires exact group field %i', async (index) => {
    const value = index === 1 ? '2024-02-29T12:00:00.000Z' : 'bench press';
    await invalid(
      `${CSV_HEADER}\n${base.join(',')}\n${row(index, value)}`,
      'CSV_ENTRY_MISMATCH',
      2,
      CSV_HEADER.split(',')[index],
    );
  });
  it.each(['1', '3'])(
    'rejects duplicate or skipped positions %s',
    async (position) => {
      await invalid(
        `${CSV_HEADER}\n${base.join(',')}\n${row(3, position)}`,
        'CSV_INVALID_POSITION',
        2,
        'setPosition',
      );
    },
  );
  it('requires each new group to start at one', async () => {
    await invalid(
      `${CSV_HEADER}\n${row(3, '2')}`,
      'CSV_INVALID_POSITION',
      1,
      'setPosition',
    );
  });
  it('rejects noncontiguous references', async () => {
    await invalid(
      `${CSV_HEADER}\n${base.join(',')}\n${row(0, 'b')}\n${base.join(',')}`,
      'CSV_REPEATED_ENTRY',
      3,
      'entryRef',
    );
  });
  it.each([0, 1, 2, 3, 4, 5, 6])('rejects NUL in field %i', async (index) => {
    await invalid(
      `${CSV_HEADER}\n${row(index, 'secret\0')}`,
      'CSV_INVALID_VALUE',
      1,
      CSV_HEADER.split(',')[index],
    );
  });
  it.each([[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xff], [0xe2, 0x82]])(
    'rejects malformed UTF-8 %#',
    async (...bytes: number[]) => {
      await invalid(
        Buffer.concat([
          Buffer.from(`${CSV_HEADER}\n${base.join(',')}`),
          Buffer.from(bytes),
        ]),
        'CSV_INVALID_ENCODING',
        null,
      );
    },
  );
  it.each(['"unclosed', 'bad"quote', '"closed"tail'])(
    'sanitizes CSV syntax errors %s',
    async (value) => {
      await invalid(
        `${CSV_HEADER}\n${row(2, 'Multi\nline')}\nb,${date},${value}`,
        'CSV_SYNTAX',
        2,
        'exerciseName',
      );
    },
  );
  it('exposes a safe Error without raw parser context', () => {
    const error = new CsvImportError('CSV_SYNTAX', 2, 'reps');
    expect(error).toBeInstanceOf(Error);
    expect(Object.keys(error).sort()).toEqual([
      'code',
      'field',
      'name',
      'record',
    ]);
    expect(error.message).toBe('Invalid workout CSV');
  });
});
