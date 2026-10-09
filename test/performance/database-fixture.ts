import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../src/database/database.service';
import { validateEnvironment } from '../../src/config/configuration';
import { ExerciseCatalogSchema } from '../../src/schemas/exercise-catalog.schema';
import { seedExerciseCatalog } from '../../scripts/seed-exercise-catalog';
import { createTestDatabase } from '../support/test-database';
import type { Counts } from './workload';

export async function createPerformanceDatabase() {
  const database = await createTestDatabase();
  const service = new DatabaseService(
    new ConfigService(
      validateEnvironment({
        DATABASE_URL: database.databaseUrl,
        LOG_LEVEL: 'silent',
      }),
    ),
  );
  const close = async () => {
    try {
      await service.onApplicationShutdown();
    } finally {
      await database.close();
    }
  };
  try {
    await seedExerciseCatalog(
      service,
      ExerciseCatalogSchema.parse(
        JSON.parse(await readFile('data/exercise-catalog.json', 'utf8')),
      ),
    );
    return {
      databaseUrl: database.databaseUrl,
      close,
      async verify(expected: Map<string, Counts>) {
        const actual: Record<string, Counts> = {};
        for (const [user, counts] of expected) {
          const result = await service.pool.query<Counts>(
            `SELECT
            (SELECT count(*)::int FROM workout_entries WHERE user_id = $1) AS entries,
            (SELECT count(*)::int FROM workout_sets s JOIN workout_entries e ON e.id=s.entry_id WHERE e.user_id=$1) AS sets,
            (SELECT count(*)::int FROM idempotency_requests WHERE user_id = $1) AS requests`,
            [user],
          );
          assert.deepEqual(
            result.rows[0],
            counts,
            `Database count mismatch for ${user}`,
          );
          actual[user] = result.rows[0]!;
        }
        const incomplete = await service.pool.query(
          'SELECT count(*)::int AS count FROM idempotency_requests WHERE response_status IS DISTINCT FROM 201 OR response_body IS NULL',
        );
        assert.equal(incomplete.rows[0].count, 0);
        return actual;
      },
      async analyze() {
        await service.pool.query('ANALYZE');
      },
      async details() {
        const version = await service.pool.query('SHOW server_version');
        const sizes = await service.pool
          .query(`SELECT relname AS table, pg_total_relation_size(oid)::text AS bytes
          FROM pg_class WHERE relname IN ('workout_entries', 'workout_sets', 'idempotency_requests') AND relnamespace='public'::regnamespace ORDER BY relname`);
        return {
          postgres: version.rows[0].server_version as string,
          tableBytesIncludingIndexesAndToast: sizes.rows,
        };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
