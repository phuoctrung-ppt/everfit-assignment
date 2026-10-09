import { RecordResponseSchema } from '../src/schemas/personal-record-response.schema';
import {
  emptyRecordMessage,
  emptyRecords,
  getRecords,
  insertTiedRecord,
  logRecord,
  recordMetrics,
} from './support/record-fixtures';
import {
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('personal records against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('selects three independent sets and exposes their achievement details', async () => {
    const entry = await logRecord(fixture, 'winners', {
      sets: [
        { weight: 100, reps: 1, unit: 'kg' },
        { weight: 60, reps: 20, unit: 'kg' },
        { weight: 90, reps: 8, unit: 'kg' },
      ],
    });
    await logRecord(
      fixture,
      'other-user',
      {
        sets: [{ weight: 1000, reps: 30, unit: 'kg' }],
      },
      'other-user',
    );
    await logRecord(fixture, 'other-exercise', {
      exerciseName: 'Squat',
      sets: [{ weight: 1000, reps: 30, unit: 'kg' }],
    });
    const result = await getRecords(fixture, {
      exerciseName: ' bEnCh PrEsS ',
    }).expect(200);
    expect(RecordResponseSchema.safeParse(result.body).success).toBe(true);
    const values = ['100.0000', '1200.0000', '114.0000'];
    recordMetrics.forEach((metric, index) => {
      expect(result.body.data[metric]).toEqual({
        value: values[index],
        unit: index === 1 ? 'kg*reps' : 'kg',
        achievedAt: entry.date,
        entryId: entry.id,
        setPosition: index + 1,
        reps: entry.sets[index]!.reps,
        weight: entry.sets[index]!.weight,
        weightUnit: 'kg',
      });
    });
    expect(result.body.message).toBeNull();
  });

  it('breaks equal mixed-unit scores by earliest date, entry ID, then position', async () => {
    const ids = [1, 2, 3].map((n) => `20000000-0000-4000-8000-00000000000${n}`);
    const early = '2026-01-01T00:00:00.000Z';
    await insertTiedRecord(fixture, ids[0]!, '2026-01-02T00:00:00Z', 'kg');
    await insertTiedRecord(fixture, ids[2]!, early, 'kg');
    await insertTiedRecord(fixture, ids[1]!, early, 'lb');
    for (const unit of ['kg', 'lb']) {
      const result = await getRecords(fixture, { unit }).expect(200);
      const values =
        unit === 'lb'
          ? ['100.0000', '800.0000', '126.6667']
          : ['45.3592', '362.8739', '57.4550'];
      for (const [index, metric] of recordMetrics.entries()) {
        expect(result.body.data[metric]).toMatchObject({
          value: values[index],
          unit: index === 1 ? `${unit}*reps` : unit,
          entryId: ids[1],
          achievedAt: early,
          setPosition: 1,
          reps: 8,
          weight: unit === 'lb' ? '100.0000' : '45.3592',
          weightUnit: unit,
        });
      }
    }
  });

  it('ranks unrounded canonical values even when displayed scores tie', async () => {
    await logRecord(fixture, 'lower', {
      date: '2026-01-01T00:00:00Z',
      sets: [{ weight: 100.000001, reps: 1, unit: 'kg' }],
    });
    const winner = await logRecord(fixture, 'higher', {
      date: '2026-01-02T00:00:00Z',
      sets: [{ weight: 100.000002, reps: 1, unit: 'kg' }],
    });
    const result = await getRecords(fixture).expect(200);
    for (const metric of recordMetrics)
      expect(result.body.data[metric].entryId).toBe(winner.id);
    expect(result.body.data.heaviestSet.value).toBe('100.0000');
    expect(result.body.data.estimatedOneRepMax.value).toBe('103.3333');
  });

  it('uses inclusive starts, exclusive ends, and open-ended bounds', async () => {
    const dates = [
      '2026-01-01T23:59:59.999Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-02T23:59:59.999Z',
      '2026-01-03T00:00:00.000Z',
    ];
    const entries = [];
    for (const [i, date] of dates.entries())
      entries.push(
        await logRecord(fixture, date, {
          date,
          sets: [{ weight: [400, 300, 200, 500][i]!, reps: 1, unit: 'kg' }],
        }),
      );
    for (const [query, winner] of [
      [{ from: dates[1], to: dates[3] }, entries[1]],
      [{ from: dates[1] }, entries[3]],
      [{ to: dates[3] }, entries[0]],
    ] as const) {
      const result = await getRecords(fixture, query).expect(200);
      for (const metric of recordMetrics)
        expect(result.body.data[metric].entryId).toBe(winner!.id);
    }
  });

  it('distinguishes known empty exercises and users from unknown exact names', async () => {
    await logRecord(fixture, 'other', {}, 'other-user');
    expect((await getRecords(fixture).expect(200)).body).toEqual({
      data: emptyRecords,
      message: emptyRecordMessage,
    });
    for (const exerciseName of [
      'Bench',
      'unknown',
      "%'; DROP TABLE exercises; --",
    ]) {
      const result = await getRecords(fixture, { exerciseName }).expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(result.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'exerciseName' }),
        ]),
      );
    }
  });
});
