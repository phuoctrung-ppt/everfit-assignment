import { WorkoutEntrySchema } from '../src/schemas/workout-response.schema';
import {
  benchId,
  createWorkoutFixture,
  postWorkout,
  workout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('atomic workout logging against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('persists ordered mixed-unit sets with exact normalization and public output', async () => {
    const response = await postWorkout(fixture.app, 'single').expect(201);
    const entry = WorkoutEntrySchema.parse(response.body.data);
    expect(entry).toMatchObject({
      userId: 'logging-user',
      date: workout.date,
      exercise: {
        id: benchId,
        name: 'Bench Press',
        muscleGroups: ['chest', 'triceps'],
      },
      sets: [
        {
          position: 1,
          reps: 5,
          weight: '61.2350',
          unit: 'kg',
          originalWeight: '135.000000',
          originalUnit: 'lb',
        },
        {
          position: 2,
          reps: 10,
          weight: '0.0000',
          unit: 'kg',
          originalWeight: '0.000000',
          originalUnit: 'kg',
        },
      ],
    });
    const stored = await fixture.service.pool.query(
      'SELECT weight_kg, original_weight, original_unit FROM workout_sets WHERE entry_id = $1 ORDER BY position',
      [entry.id],
    );
    expect(stored.rows).toEqual([
      {
        weight_kg: '61.23496995000000',
        original_weight: '135.000000',
        original_unit: 'lb',
      },
      {
        weight_kg: '0.00000000000000',
        original_weight: '0.000000',
        original_unit: 'kg',
      },
    ]);
    expect(await fixture.counts()).toEqual({
      entries: 1,
      sets: 2,
      requests: 1,
    });
  });

  it('commits every bulk entry in request order, including repeated exercises and timestamps', async () => {
    const entries = [workout, { ...workout, exerciseName: 'Squat' }, workout];
    const response = await postWorkout(
      fixture.app,
      'bulk',
      { entries },
      'logging-user',
      true,
    ).expect(201);
    expect(
      response.body.data.map(
        (entry: { exercise: { name: string } }) => entry.exercise.name,
      ),
    ).toEqual(['Bench Press', 'Squat', 'Bench Press']);
    for (const entry of response.body.data) WorkoutEntrySchema.parse(entry);
    expect(
      new Set(response.body.data.map((entry: { id: string }) => entry.id)).size,
    ).toBe(3);
    expect(await fixture.counts()).toEqual({
      entries: 3,
      sets: 6,
      requests: 1,
    });
  });

  it.each([false, true])(
    'rejects unknown exercise with indexed details and frees the key (bulk=%s)',
    async (bulk) => {
      const missing = {
        ...workout,
        exerciseName: "unknown'; DROP TABLE exercises; --",
      };
      const body = bulk ? { entries: [workout, missing] } : missing;
      const response = await postWorkout(
        fixture.app,
        'unknown',
        body,
        'logging-user',
        bulk,
      ).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: bulk ? 'entries.1.exerciseName' : 'exerciseName',
          }),
        ]),
      );
      expect(JSON.stringify(response.body)).not.toMatch(
        /DROP TABLE|postgres|stack/,
      );
      expect(await fixture.counts()).toEqual({
        entries: 0,
        sets: 0,
        requests: 0,
      });
      await postWorkout(
        fixture.app,
        'unknown',
        bulk ? { entries: [workout] } : workout,
        'logging-user',
        bulk,
      ).expect(201);
    },
  );
});
