import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertTestDatabaseUrl, runTestMigrations } from './support/migrations';
import type { TestDatabase } from './support/test-database';
import { createTestDatabase } from './support/test-database';

describe('workout schema', () => {
  let database: TestDatabase;
  let pool: Pool;
  let exerciseId: string;
  let entryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    pool = new Pool({ connectionString: database.databaseUrl });
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE workout_sets, workout_entries, exercise_muscle_groups, exercises, muscle_groups, idempotency_requests',
    );
    exerciseId = randomUUID();
    entryId = randomUUID();
    await pool.query(
      'INSERT INTO exercises (id, name, normalized_name) VALUES ($1, $2, $3)',
      [exerciseId, 'Squat', 'squat'],
    );
    await pool.query(
      'INSERT INTO workout_entries (id, user_id, exercise_id, performed_at) VALUES ($1, $2, $3, $4)',
      [entryId, 'athlete-1', exerciseId, '2026-01-01T12:00:00.000Z'],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  function insertSet(
    overrides: {
      entry?: string;
      position?: number;
      reps?: number;
      original?: string;
      kg?: string;
    } = {},
  ) {
    return pool.query(
      'INSERT INTO workout_sets (id, entry_id, position, reps, original_weight, original_unit, weight_kg) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        randomUUID(),
        overrides.entry ?? entryId,
        overrides.position ?? 1,
        overrides.reps ?? 5,
        overrides.original ?? '10',
        'kg',
        overrides.kg ?? '10',
      ],
    );
  }

  it('isolates the database and refuses non-test migration targets', () => {
    expect(new URL(database.databaseUrl).pathname).toMatch(
      /^\/everfit_test_[a-f0-9]{32}$/,
    );
    expect(() => assertTestDatabaseUrl('postgres://localhost/everfit')).toThrow(
      'Refusing',
    );
    expect(() =>
      assertTestDatabaseUrl('postgres://localhost/everfit_test_shared'),
    ).toThrow('Refusing');
  });

  it('enforces idempotency uniqueness per user while allowing other users to use the key', async () => {
    const sql =
      'INSERT INTO idempotency_requests (user_id, key, fingerprint) VALUES ($1, $2, $3)';
    await pool.query(sql, ['athlete-1', 'request-key', 'a'.repeat(64)]);
    await expect(
      pool.query(sql, ['athlete-1', 'request-key', 'b'.repeat(64)]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(sql, ['athlete-2', 'request-key', 'a'.repeat(64)]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('enforces unique positive set positions within each entry', async () => {
    await insertSet();
    await expect(insertSet()).rejects.toMatchObject({ code: '23505' });
    await expect(insertSet({ position: 0 })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertSet({ position: -1 })).rejects.toMatchObject({
      code: '23514',
    });
  });

  it.each([0, -1, 10001])(
    'rejects reps outside the accepted bounds: %s',
    async (reps) => {
      await expect(insertSet({ reps })).rejects.toMatchObject({
        code: '23514',
      });
    },
  );

  it('rejects fractional reps', async () => {
    await expect(insertSet({ reps: 1.5 })).rejects.toMatchObject({
      code: '22P02',
    });
  });

  it.each(['-0.000001', '1000000.000001', 'NaN'])(
    'rejects invalid original weight: %s',
    async (original) => {
      await expect(insertSet({ original })).rejects.toMatchObject({
        code: '23514',
      });
    },
  );

  it.each(['-0.00000000000001', 'NaN'])(
    'rejects invalid normalized weight: %s',
    async (kg) => {
      await expect(insertSet({ kg })).rejects.toMatchObject({ code: '23514' });
    },
  );

  it('preserves exact NUMERIC strings and accepts zero and upper bounds', async () => {
    await insertSet({ original: '0', kg: '0', reps: 1 });
    await insertSet({
      position: 2,
      original: '1000000',
      kg: '453592.37',
      reps: 10000,
    });
    await insertSet({
      position: 3,
      original: '0.123456',
      kg: '0.05599918864272',
    });
    const result = await pool.query<{
      original_weight: string;
      weight_kg: string;
    }>(
      'SELECT original_weight, weight_kg FROM workout_sets WHERE position = 3',
    );
    expect(result.rows[0]).toEqual({
      original_weight: '0.123456',
      weight_kg: '0.05599918864272',
    });
  });

  it('rejects dangling foreign keys and preserves historical entries on catalog deletion', async () => {
    await expect(insertSet({ entry: randomUUID() })).rejects.toMatchObject({
      code: '23503',
    });
    await expect(
      pool.query(
        'INSERT INTO workout_entries (id, user_id, exercise_id, performed_at) VALUES ($1, $2, $3, NOW())',
        [randomUUID(), 'athlete-1', randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query(
        'INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id) VALUES ($1, $2)',
        [exerciseId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query('DELETE FROM exercises WHERE id = $1', [exerciseId]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('allows distinct entries for the same user, exercise, and timestamp', async () => {
    await expect(
      pool.query(
        'INSERT INTO workout_entries (id, user_id, exercise_id, performed_at) VALUES ($1, $2, $3, $4)',
        [randomUUID(), 'athlete-1', exerciseId, '2026-01-01T12:00:00.000Z'],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('reruns migrations as a no-op and rolls back/reapplies an empty isolated schema', async () => {
    await expect(runTestMigrations(database.databaseUrl)).resolves.toBe(0);
    await pool.query('TRUNCATE workout_entries, exercises CASCADE');
    for (let migration = 0; migration < 4; migration++) {
      await expect(
        runTestMigrations(database.databaseUrl, 'down'),
      ).resolves.toBe(1);
    }
    const result = await pool.query<{ name: string | null }>(
      "SELECT to_regclass('public.workout_entries')::text AS name",
    );
    expect(result.rows[0]?.name).toBeNull();
    await expect(runTestMigrations(database.databaseUrl)).resolves.toBe(4);
  });
});
