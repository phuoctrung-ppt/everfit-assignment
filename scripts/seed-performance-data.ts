import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../src/database/database.service';
import { validateEnvironment } from '../src/config/configuration';
import { ExerciseCatalogSchema } from '../src/schemas/exercise-catalog.schema';
import { assertTestDatabaseUrl } from '../test/support/migrations';
import type { ReadEntry } from '../test/performance/read-dataset';
import { seedExerciseCatalog } from './seed-exercise-catalog';

export function performanceDatabase(databaseUrl: string) {
  assertTestDatabaseUrl(databaseUrl);
  return new DatabaseService(
    new ConfigService(
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        LOG_LEVEL: 'silent',
        DB_STATEMENT_TIMEOUT_MS: '300000',
      }),
    ),
  );
}

export async function verifyReadCounts(
  database: DatabaseService,
  entries: ReadEntry[],
) {
  const result = await database.pool.query(`SELECT e.user_id AS "userId",
    count(DISTINCT e.id)::int AS entries, count(s.id)::int AS sets
    FROM workout_entries e JOIN workout_sets s ON s.entry_id=e.id
    GROUP BY e.user_id ORDER BY e.user_id`);
  const users = [...new Set(entries.map((entry) => entry.userId))].sort();
  const expected = users.map((userId) => {
    const selected = entries.filter((entry) => entry.userId === userId);
    return {
      userId,
      entries: selected.length,
      sets: selected.reduce((sum, entry) => sum + entry.sets.length, 0),
    };
  });
  assert.deepEqual(result.rows, expected);
  return expected;
}

export async function seedPerformanceData(
  database: DatabaseService,
  entries: ReadEntry[],
) {
  // Refuse populated targets; this loader never truncates caller-owned databases.
  const occupied = await database.pool.query(`SELECT
    EXISTS(SELECT 1 FROM workout_entries) OR EXISTS(SELECT 1 FROM workout_sets)
    OR EXISTS(SELECT 1 FROM idempotency_requests) AS occupied`);
  assert.equal(
    occupied.rows[0].occupied,
    false,
    'Benchmark requires an empty test database',
  );
  await seedExerciseCatalog(
    database,
    ExerciseCatalogSchema.parse(
      JSON.parse(await readFile('data/exercise-catalog.json', 'utf8')),
    ),
  );
  await database.withTransaction(async (client) => {
    for (let offset = 0; offset < entries.length; offset += 500) {
      const batch = entries.slice(offset, offset + 500);
      await client.query(
        `INSERT INTO workout_entries
        (id, user_id, exercise_id, performed_at, created_at)
        SELECT id, "userId", "exerciseId", date, "createdAt"
        FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, "userId" text,
          "exerciseId" uuid, date timestamptz, "createdAt" timestamptz)`,
        [
          JSON.stringify(
            batch.map((entry) => ({
              ...entry,
              exerciseId: entry.exercise.id,
              sets: undefined,
            })),
          ),
        ],
      );
      await client.query(
        `INSERT INTO workout_sets
        (id, entry_id, position, reps, original_weight, original_unit, weight_kg)
        SELECT id, "entryId", position, reps, "originalWeight", "originalUnit", "weightKg"
        FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, "entryId" uuid,
          position int, reps int, "originalWeight" numeric, "originalUnit" text, "weightKg" numeric)`,
        [
          JSON.stringify(
            batch.flatMap((entry) =>
              entry.sets.map((set) => ({ ...set, entryId: entry.id })),
            ),
          ),
        ],
      );
    }
  });
  const counts = await verifyReadCounts(database, entries);
  await database.pool.query('ANALYZE');
  return counts;
}
