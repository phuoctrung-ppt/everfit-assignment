import type { CreateWorkoutDto } from '../../schemas/workout.schema';
import { CSV_HEADER } from '../../schemas/csv-import.schema';
import { parseWorkoutCsv } from './csv-parser';

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

describe('CSV field validation', () => {
  it.each([
    [0, ''],
    [0, 'a.b'],
    [0, 'é'],
    [0, 'a'.repeat(129)],
    [0, 'a\n'],
    [1, '2023-02-29T12:00:00Z'],
    [1, '2024-01-01'],
    [1, '2024-01-01T00:00:00+00:00'],
    [2, ' '],
    [2, 'x'.repeat(201)],
    [6, 'KG'],
    [6, 'stone'],
  ] as const)('validates field %i value %j', async (index, value) => {
    await invalid(
      `${CSV_HEADER}\n${row(index, value)}`,
      'CSV_INVALID_VALUE',
      1,
      CSV_HEADER.split(',')[index],
    );
  });
  it.each([
    '0',
    '-1',
    '+1',
    '01',
    '1.0',
    '1e1',
    'Infinity',
    'NaN',
    ' 1',
    '1 ',
    '1\n',
    '1\r',
    '',
    '0x10',
    '10001',
  ])('rejects noncanonical or out-of-range reps %j', async (value) => {
    await invalid(
      `${CSV_HEADER}\n${row(4, value)}`,
      'CSV_INVALID_VALUE',
      1,
      'reps',
    );
  });
  it.each([
    '-0',
    '-1',
    '+1',
    '01',
    '.5',
    '1.',
    '1e2',
    'Infinity',
    'NaN',
    ' 1',
    '1 ',
    '1\n',
    '',
    '0x10',
    '0.0000001',
    '1.0000000',
    '1000000.000001',
  ])('rejects noncanonical or out-of-range weight %j', async (value) => {
    await invalid(
      `${CSV_HEADER}\n${row(5, value)}`,
      'CSV_INVALID_VALUE',
      1,
      'weight',
    );
  });
  it.each([
    '0',
    '0.000001',
    '1.123456',
    '999999.999999',
    '1000000',
    '1.000000',
  ])('accepts decimal weight %s', async (value) => {
    expect(
      (await read(`${CSV_HEADER}\n${row(5, value)}`))[0]?.entry.sets[0]?.weight,
    ).toBe(Number(value));
  });
  it.each(['0', '01', '1.0', '1e0', ' 1', '1\n', '101'])(
    'rejects invalid position %j',
    async (value) => {
      await invalid(
        `${CSV_HEADER}\n${row(3, value)}`,
        'CSV_INVALID_VALUE',
        1,
        'setPosition',
      );
    },
  );
});
