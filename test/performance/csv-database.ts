import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { assertTestDatabaseUrl } from '../support/migrations';

export function createCsvPool(databaseUrl: string) {
  assertTestDatabaseUrl(databaseUrl);
  return new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 60000,
    statement_timeout: 55000,
    lock_timeout: 3000,
  });
}

export async function installCsvFault(pool: Pool) {
  await pool.query(`
    CREATE SEQUENCE csv_benchmark_failure_attempts;
    CREATE FUNCTION csv_benchmark_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF nextval('csv_benchmark_failure_attempts') = 1 THEN
        RAISE EXCEPTION 'Injected CSV transient failure' USING ERRCODE = '40001';
      END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER csv_benchmark_failure AFTER INSERT ON workout_entries
      FOR EACH ROW WHEN (NEW.user_id = 'csv-benchmark' AND NEW.performed_at =
        timestamptz '2026-01-01T00:00:00Z' + 25000 * interval '1 minute')
      EXECUTE FUNCTION csv_benchmark_failure();
  `);
}

export async function removeCsvFault(pool: Pool) {
  await pool.query(`
    DROP TRIGGER IF EXISTS csv_benchmark_failure ON workout_entries;
    DROP FUNCTION IF EXISTS csv_benchmark_failure();
    DROP SEQUENCE IF EXISTS csv_benchmark_failure_attempts;
  `);
}

export async function csvFaultEvidence(pool: Pool) {
  const result = await pool.query<{ attempts: number; called: boolean }>(
    'SELECT last_value::int AS attempts, is_called AS called FROM csv_benchmark_failure_attempts',
  );
  assert.deepEqual(result.rows[0], { attempts: 2, called: true });
  return {
    entryIndexZeroBased: 25000,
    sqlState: '40001',
    injectedFailures: 1,
    ...result.rows[0],
  };
}

export async function assertNoCsvWorkouts(pool: Pool) {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM workout_entries) AS entries,
    (SELECT count(*)::int FROM workout_sets) AS sets,
    (SELECT count(*)::int FROM workout_imports) AS imports`);
  assert.deepEqual(result.rows[0], { entries: 0, sets: 0, imports: 1 });
  return result.rows[0] as { entries: number; sets: number; imports: number };
}

export async function verifyCsvDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query(
      await readFile('test/performance/verify-csv-import.sql', 'utf8'),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  // Include generated IDs and every stored column to detect replacement on replay.
  const result = await pool.query<{
    entries: string;
    sets: string;
    imports: string;
    batches: string | null;
  }>(`SELECT
    (SELECT md5(string_agg(to_jsonb(e)::text, ',' ORDER BY e.id)) FROM workout_entries e) AS entries,
    (SELECT md5(string_agg(to_jsonb(s)::text, ',' ORDER BY s.id)) FROM workout_sets s) AS sets,
    (SELECT md5(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id)) FROM workout_imports i) AS imports,
    (SELECT md5(string_agg(to_jsonb(b)::text, ',' ORDER BY b.import_id,b.position)) FROM workout_import_batches b) AS batches`);
  return {
    entries: 50000,
    sets: 150000,
    batches: 500,
    exactSqlOraclePassed: true,
    fingerprints: result.rows[0]!,
  };
}
