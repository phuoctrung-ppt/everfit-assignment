import { RecordComparisonResponseSchema } from '../src/schemas/personal-record-response.schema';
import {
  comparisonQuery,
  emptyRecordMessage,
  emptyRecords,
  getRecords,
  logRecord,
  recordMetrics,
} from './support/record-fixtures';
import {
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('record comparisons against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('returns signed differences, achievement details, and requested units', async () => {
    const baseline = await logRecord(fixture, 'baseline', {
      date: comparisonQuery.baselineFrom,
      sets: [{ weight: 60, reps: 8, unit: 'kg' }],
    });
    const comparison = await logRecord(fixture, 'comparison', {
      date: comparisonQuery.comparisonFrom,
      sets: [{ weight: 70, reps: 8, unit: 'kg' }],
    });
    await logRecord(
      fixture,
      'other',
      {
        date: comparisonQuery.comparisonFrom,
        sets: [{ weight: 1000, reps: 20, unit: 'kg' }],
      },
      'other-user',
    );
    for (const [unit, expected] of [
      ['kg', ['10.0000', '80.0000', '12.6667']],
      ['lb', ['22.0462', '176.3698', '27.9252']],
    ] as const) {
      const response = await getRecords(
        fixture,
        { ...comparisonQuery, unit },
        true,
      ).expect(200);
      const { data } = response.body;
      expect(
        RecordComparisonResponseSchema.safeParse(response.body).success,
      ).toBe(true);
      expect(new Date(data.baseline.range.from).toISOString()).toBe(
        baseline.date,
      );
      expect(new Date(data.comparison.range.from).toISOString()).toBe(
        comparison.date,
      );
      recordMetrics.forEach((metric, i) => {
        expect(data.baseline.records[metric].entryId).toBe(baseline.id);
        expect(data.comparison.records[metric].entryId).toBe(comparison.id);
        expect(data.differences[metric]).toEqual({
          value: expected[i],
          unit: i === 1 ? `${unit}*reps` : unit,
        });
      });
      expect(data.baseline.message).toBeNull();
      expect(data.comparison.message).toBeNull();
    }
    const reversed = await getRecords(
      fixture,
      {
        baselineFrom: comparisonQuery.comparisonFrom,
        baselineTo: comparisonQuery.comparisonTo,
        comparisonFrom: comparisonQuery.baselineFrom,
        comparisonTo: comparisonQuery.baselineTo,
      },
      true,
    ).expect(200);
    expect(
      recordMetrics.map(
        (metric) => reversed.body.data.differences[metric].value,
      ),
    ).toEqual(['-10.0000', '-80.0000', '-12.6667']);
  });

  it('subtracts exact values before output rounding', async () => {
    for (const [date, weight] of [
      [comparisonQuery.baselineFrom, 100.000049],
      [comparisonQuery.comparisonFrom, 100.000051],
    ] as const)
      await logRecord(fixture, date, {
        date,
        sets: [{ weight, reps: 1, unit: 'kg' }],
      });
    const { body } = await getRecords(fixture, comparisonQuery, true).expect(
      200,
    );
    expect(body.data.baseline.records.heaviestSet.value).toBe('100.0000');
    expect(body.data.comparison.records.heaviestSet.value).toBe('100.0001');
    for (const metric of recordMetrics)
      expect(body.data.differences[metric].value).toBe('0.0000');
  });

  it('evaluates overlapping periods independently and excludes their end boundaries', async () => {
    const baseline = await logRecord(fixture, 'baseline', {
      date: '2026-01-01T00:00:00Z',
      sets: [
        { weight: 100, reps: 1, unit: 'kg' },
        { weight: 60, reps: 20, unit: 'kg' },
      ],
    });
    const shared = await logRecord(fixture, 'shared', {
      date: '2026-01-02T00:00:00Z',
      sets: [{ weight: 90, reps: 8, unit: 'kg' }],
    });
    const comparison = await logRecord(fixture, 'comparison', {
      date: '2026-01-03T00:00:00Z',
      sets: [
        { weight: 95, reps: 1, unit: 'kg' },
        { weight: 55, reps: 20, unit: 'kg' },
      ],
    });
    await logRecord(fixture, 'excluded', {
      date: '2026-01-04T00:00:00Z',
      sets: [{ weight: 1000, reps: 30, unit: 'kg' }],
    });
    const { body } = await getRecords(
      fixture,
      {
        baselineFrom: '2026-01-01T00:00:00Z',
        baselineTo: '2026-01-03T00:00:00Z',
        comparisonFrom: '2026-01-02T00:00:00Z',
        comparisonTo: '2026-01-04T00:00:00Z',
      },
      true,
    ).expect(200);
    expect(
      recordMetrics.map((m) => body.data.baseline.records[m].entryId),
    ).toEqual([baseline.id, baseline.id, shared.id]);
    expect(
      recordMetrics.map((m) => body.data.comparison.records[m].entryId),
    ).toEqual([comparison.id, comparison.id, shared.id]);
    expect(recordMetrics.map((m) => body.data.differences[m].value)).toEqual([
      '-5.0000',
      '-100.0000',
      '0.0000',
    ]);
  });

  it('distinguishes missing periods from real zero records and differences', async () => {
    const zero = await logRecord(fixture, 'zero-baseline', {
      date: comparisonQuery.baselineFrom,
      sets: [{ weight: 0, reps: 8, unit: 'kg' }],
    });
    const first = await getRecords(fixture, comparisonQuery, true).expect(200);
    expect(first.body.data.comparison.records).toEqual(emptyRecords);
    expect(first.body.data.comparison.message).toBe(emptyRecordMessage);
    expect(first.body.data.differences).toEqual(emptyRecords);
    for (const metric of recordMetrics)
      expect(first.body.data.baseline.records[metric]).toMatchObject({
        value: '0.0000',
        entryId: zero.id,
      });
    await logRecord(fixture, 'zero-comparison', {
      date: comparisonQuery.comparisonFrom,
      sets: [{ weight: 0, reps: 1, unit: 'lb' }],
    });
    const second = await getRecords(fixture, comparisonQuery, true).expect(200);
    expect(second.body.data.comparison.message).toBeNull();
    for (const metric of recordMetrics)
      expect(second.body.data.differences[metric].value).toBe('0.0000');
    const empty = await getRecords(
      fixture,
      comparisonQuery,
      true,
      'empty-user',
    ).expect(200);
    for (const period of ['baseline', 'comparison']) {
      expect(empty.body.data[period].records).toEqual(emptyRecords);
      expect(empty.body.data[period].message).toBe(emptyRecordMessage);
    }
    expect(empty.body.data.differences).toEqual(emptyRecords);
  });
});
