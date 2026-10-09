import { HistoryQuerySchema } from './history-query.schema';

describe('history query', () => {
  it('defaults pagination/unit and normalizes filters', () => {
    expect(HistoryQuerySchema.parse({})).toEqual({ limit: 20, unit: 'kg' });
    expect(
      HistoryQuerySchema.parse({
        exerciseName: ' BENCH ',
        muscleGroup: ' CHEST ',
        limit: '100',
      }),
    ).toEqual({
      exerciseName: 'bench',
      muscleGroup: 'chest',
      limit: 100,
      unit: 'kg',
    });
  });

  it.each([
    { from: '2026-01-01T00:00:00Z' },
    { to: '2026-01-01T00:00:00Z' },
    { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00.001Z' },
  ])('accepts valid open or ordered range %j', (query) => {
    expect(HistoryQuerySchema.safeParse(query).success).toBe(true);
  });

  it.each([
    { limit: '101' },
    { limit: '01' },
    { limit: '1.0' },
    { limit: ['1', '2'] },
    { unit: ['kg', 'lb'] },
    { unit: 'stone' },
    { unknown: 'x' },
    { exerciseName: '' },
    { exerciseName: '\u0000' },
    { muscleGroup: '  ' },
    { exerciseName: 'a'.repeat(201) },
    { muscleGroup: 'a'.repeat(81) },
    { from: '2026-02-30T00:00:00Z' },
    { from: '2026-01-01' },
    { from: '2026-01-01T00:00:00+01:00' },
    { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00.000Z' },
    { from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' },
  ])('rejects invalid query %j', (query) => {
    expect(HistoryQuerySchema.safeParse(query).success).toBe(false);
  });
});
