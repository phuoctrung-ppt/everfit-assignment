import { BulkWorkoutResponseSchema } from '../src/schemas/workout-logging.schema';
import { WorkoutEntrySchema } from '../src/schemas/workout-response.schema';
import {
  expectedPersistenceDigest,
  verifyPersistedWorkouts,
} from './performance/persistence-oracle';
import {
  createWorkoutFixture,
  postWorkout,
  type WorkoutFixture,
} from './support/workout-fixtures';

const input = {
  date: '2026-02-01T12:34:56.789Z',
  exerciseName: 'Bench Press',
  sets: [
    { reps: 7, weight: 1.234567, unit: 'lb' as const },
    { reps: 13, weight: 0.000001, unit: 'kg' as const },
  ],
};

describe('bulk persistence oracle against real PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it.each([
    ['user', "UPDATE workout_entries SET user_id = 'wrong-user'"],
    [
      'exercise',
      "UPDATE workout_entries SET exercise_id = '10000000-0000-4000-8000-000000000002'",
    ],
    [
      'date',
      "UPDATE workout_entries SET performed_at = performed_at + interval '1 ms'",
    ],
    [
      'creation timestamp',
      "UPDATE workout_entries SET created_at = created_at + interval '1 ms'",
    ],
    ['reps', 'UPDATE workout_sets SET reps = reps + 1'],
    ['position', 'UPDATE workout_sets SET position = 3 WHERE position = 1'],
    [
      'original weight',
      'UPDATE workout_sets SET original_weight = original_weight + 0.000001',
    ],
    [
      'original unit',
      "UPDATE workout_sets SET original_unit = 'kg' WHERE position = 1",
    ],
    [
      'exact kg',
      'UPDATE workout_sets SET weight_kg = weight_kg + 0.00000000000001',
    ],
    ['set identity', 'UPDATE workout_sets SET id = gen_random_uuid()'],
    ['missing set', 'DELETE FROM workout_sets WHERE position = 1'],
    [
      'extra set',
      `INSERT INTO workout_sets SELECT gen_random_uuid(), entry_id, 3, reps,
       original_weight, original_unit, weight_kg FROM workout_sets WHERE position = 1`,
    ],
  ])(
    'detects corrupt %s even when the HTTP response was correct',
    async (_name, sql) => {
      const response = await postWorkout(fixture.app, 'oracle', input).expect(
        201,
      );
      const entry = WorkoutEntrySchema.parse(response.body.data);
      const expected = new Map([
        [entry.id, expectedPersistenceDigest('logging-user', input, entry)],
      ]);
      await expect(
        verifyPersistedWorkouts(fixture.service.pool, expected),
      ).resolves.toEqual({
        entries: 1,
        sets: 2,
      });
      await fixture.service.pool.query(sql);
      await expect(
        verifyPersistedWorkouts(fixture.service.pool, expected),
      ).rejects.toThrow('Persistence mismatch');
    },
  );

  it('checks every page and detects unexpected and missing entries', async () => {
    const expected = new Map<string, string>();
    for (const [batch, count] of [100, 100, 51].entries()) {
      const inputs = Array.from({ length: count }, () => input);
      const response = await postWorkout(
        fixture.app,
        `page-${batch}`,
        { entries: inputs },
        'logging-user',
        true,
      ).expect(201);
      const entries = BulkWorkoutResponseSchema.parse(response.body).data;
      entries.forEach((entry, index) =>
        expected.set(
          entry.id,
          expectedPersistenceDigest('logging-user', inputs[index]!, entry),
        ),
      );
    }
    await expect(
      verifyPersistedWorkouts(fixture.service.pool, expected),
    ).resolves.toEqual({
      entries: 251,
      sets: 502,
    });
    const extra = await postWorkout(fixture.app, 'unexpected', input).expect(
      201,
    );
    await expect(
      verifyPersistedWorkouts(fixture.service.pool, expected),
    ).rejects.toThrow('Persistence mismatch');
    const ids = [extra.body.data.id as string, expected.keys().next().value!];
    await fixture.service.pool.query(
      'DELETE FROM workout_sets WHERE entry_id = ANY($1::uuid[])',
      [ids],
    );
    await fixture.service.pool.query(
      'DELETE FROM workout_entries WHERE id = ANY($1::uuid[])',
      [ids],
    );
    await expect(
      verifyPersistedWorkouts(fixture.service.pool, expected),
    ).rejects.toThrow('Missing persisted workout entries');
  });
});
