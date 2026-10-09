import {
  PersonalRecordQuerySchema,
  RecordComparisonQuerySchema,
} from './personal-record-query.schema';

const range = {
  exerciseName: 'Bench Press',
  baselineFrom: '2026-01-01T00:00:00Z',
  baselineTo: '2026-02-01T00:00:00Z',
  comparisonFrom: '2026-01-15T00:00:00Z',
  comparisonTo: '2026-03-01T00:00:00Z',
};
describe('personal record query contracts', () => {
  it('defaults kg and supports either open bound', () => {
    expect(
      PersonalRecordQuerySchema.parse({ exerciseName: ' Bench PRESS ' }),
    ).toEqual({ exerciseName: ' Bench PRESS ', unit: 'kg' });
    for (const bound of ['from', 'to']) {
      expect(
        PersonalRecordQuerySchema.safeParse({
          exerciseName: 'Bench Press',
          [bound]: range.baselineFrom,
        }).success,
      ).toBe(true);
    }
  });
  it('allows independently valid overlapping comparison periods', () => {
    expect(RecordComparisonQuerySchema.parse(range).unit).toBe('kg');
  });
  it.each([
    'baselineFrom',
    'baselineTo',
    'comparisonFrom',
    'comparisonTo',
  ] as const)('requires %s', (field) => {
    expect(
      RecordComparisonQuerySchema.safeParse({ ...range, [field]: undefined })
        .success,
    ).toBe(false);
  });
  it.each([
    { baselineTo: range.baselineFrom },
    { comparisonTo: range.comparisonFrom },
    { baselineFrom: '2026-02-30T00:00:00Z' },
    { comparisonFrom: '2026-01-01T00:00:00+00:00' },
    { baselineTo: '2026-02-01T00:00:00.0001Z' },
    { unit: 'stone' },
    { exerciseName: ['Bench Press'] },
    { from: range.baselineFrom },
  ])('rejects invalid comparison %j', (override) => {
    expect(
      RecordComparisonQuerySchema.safeParse({ ...range, ...override }).success,
    ).toBe(false);
  });
});
