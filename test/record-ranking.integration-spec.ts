import { PersonalRecordsRepository } from '../src/modules/personal-records/personal-records.repository';
import {
  estimatedOneRepMaxKg,
  setVolumeKg,
} from '../src/modules/personal-records/record-calculations';
import {
  comparisonQuery,
  getRecords,
  logRecord,
} from './support/record-fixtures';
import {
  benchId,
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('exact record ranking and bounded repository results', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('breaks equal Epley numerators across different reps by achievement date', async () => {
    const first = await logRecord(fixture, 'first', {
      date: '2026-01-01T00:00:00Z',
      sets: [{ weight: 93, reps: 10, unit: 'kg' }],
    });
    const second = await logRecord(fixture, 'second', {
      date: '2026-01-02T00:00:00Z',
      sets: [{ weight: 120, reps: 1, unit: 'kg' }],
    });
    const { body } = await getRecords(fixture).expect(200);
    expect(body.data.estimatedOneRepMax).toMatchObject({
      value: '124.0000',
      entryId: first.id,
      reps: 10,
    });
    expect(body.data.heaviestSet.entryId).toBe(second.id);
    expect(body.data.highestVolumeSet.entryId).toBe(first.id);
  });

  it('selects both periods in one query and returns only six winners matching formula fixtures', async () => {
    for (const date of [
      comparisonQuery.baselineFrom,
      comparisonQuery.comparisonFrom,
    ]) {
      await logRecord(fixture, date, {
        date,
        sets: [
          { weight: 100, reps: 1, unit: 'kg' },
          { weight: 60, reps: 20, unit: 'kg' },
          { weight: 90, reps: 8, unit: 'kg' },
        ],
      });
    }
    const query = jest.spyOn(fixture.service.pool, 'query');
    try {
      const rows = await fixture.app
        .get(PersonalRecordsRepository)
        .selectWinners('records-user', benchId, [
          {
            period: 'baseline',
            from: comparisonQuery.baselineFrom,
            to: comparisonQuery.baselineTo,
          },
          {
            period: 'comparison',
            from: comparisonQuery.comparisonFrom,
            to: comparisonQuery.comparisonTo,
          },
        ]);
      expect(query).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(6);
      for (const period of ['baseline', 'comparison']) {
        const winners = rows.filter((row) => row.period === period);
        expect(winners).toHaveLength(3);
        const expected = {
          heaviestSet: '100',
          highestVolumeSet: setVolumeKg('60', 20),
          estimatedOneRepMax: estimatedOneRepMaxKg('90', 8),
        };
        for (const row of winners) {
          expect(row.canonical_value.replace(/\.0+$/, '')).toBe(
            expected[row.metric],
          );
        }
      }
    } finally {
      query.mockRestore();
    }
  });
});
