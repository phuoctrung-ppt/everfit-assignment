import { Client } from 'pg';
import { assertTestDatabaseUrl } from '../support/migrations';

/** Test-only, real PostgreSQL failure after rows are written but before COMMIT. */
export async function installRecordFailure(databaseUrl: string) {
  assertTestDatabaseUrl(databaseUrl);
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 5000,
    lock_timeout: 1000,
  });
  try {
    await client.connect();
  } catch (error) {
    await client.end();
    throw error;
  }
  const close = async () => {
    try {
      await client.query(`
        DROP TRIGGER IF EXISTS benchmark_record_failure ON workout_sets;
        DROP FUNCTION IF EXISTS benchmark_record_failure();
        DROP SEQUENCE IF EXISTS benchmark_failure_attempts,
          benchmark_failure_entries, benchmark_failure_sets;
      `);
    } finally {
      await client.end();
    }
  };
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE SEQUENCE benchmark_failure_attempts;
      CREATE SEQUENCE benchmark_failure_entries;
      CREATE SEQUENCE benchmark_failure_sets;
      CREATE FUNCTION benchmark_record_failure() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF nextval('benchmark_failure_attempts') = 1 THEN
          PERFORM setval('benchmark_failure_entries',
            (SELECT count(*) FROM workout_entries));
          PERFORM setval('benchmark_failure_sets',
            (SELECT count(*) FROM workout_sets));
          RAISE EXCEPTION 'Injected transient record failure' USING ERRCODE = '55P03';
        END IF;
        RETURN NEW;
      END $fn$;
      CREATE TRIGGER benchmark_record_failure AFTER INSERT ON workout_sets
        FOR EACH ROW WHEN (NEW.reps = 9999 AND NEW.position = 2)
        EXECUTE FUNCTION benchmark_record_failure();
    `);
    await client.query('COMMIT');
    return {
      close,
      async evidence() {
        // Sequences deliberately survive rollback, preserving proof of the fault.
        const result = await client.query<{
          attempts: number;
          entriesSeenBeforeRollback: number;
          setsSeenBeforeRollback: number;
        }>(`SELECT
          (SELECT last_value::int FROM benchmark_failure_attempts) AS attempts,
          (SELECT last_value::int FROM benchmark_failure_entries) AS "entriesSeenBeforeRollback",
          (SELECT last_value::int FROM benchmark_failure_sets) AS "setsSeenBeforeRollback"`);
        return result.rows[0]!;
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
    throw error;
  }
}
