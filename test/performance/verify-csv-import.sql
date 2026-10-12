-- Independent, read-only oracle; also runnable with psql -v ON_ERROR_STOP=1.
BEGIN READ ONLY;
DO $check$
DECLARE
  mismatches bigint;
BEGIN
  IF current_database() !~ '^everfit_test_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Expected isolated test database';
  END IF;
  IF (SELECT count(*) FROM workout_entries) <> 50000
    OR (SELECT count(*) FROM workout_sets) <> 150000
    OR (SELECT count(*) FROM workout_imports) <> 1
    OR (SELECT count(*) FROM workout_import_batches) <> 0 THEN
    RAISE EXCEPTION 'Incorrect entry/set/import counts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM exercises
    WHERE id = '10000000-0000-4000-8000-000000000001' AND name = 'Bench Press') THEN
    RAISE EXCEPTION 'Bench Press catalog mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM workout_imports WHERE
    user_id IS DISTINCT FROM 'csv-benchmark'
    OR idempotency_key IS DISTINCT FROM 'csv-benchmark-50000-v1'
    OR status IS DISTINCT FROM 'completed' OR error IS NOT NULL
    OR total_entries <> 50000 OR total_sets <> 150000 OR total_batches <> 500
    OR completed_batches <> 500 OR processed_entries <> 50000
    OR processed_sets <> 150000 OR retry_count <> 1
    OR source IS NOT NULL OR attempts <> 0) THEN
    RAISE EXCEPTION 'Incorrect durable job completion or retry counters';
  END IF;

  -- EXCEPT ALL in BOTH directions detects missing, extra, duplicate and wrong rows.
  WITH expected AS (
    SELECT 'csv-benchmark'::text AS user_id,
      '10000000-0000-4000-8000-000000000001'::uuid AS exercise_id,
      timestamptz '2026-01-01T00:00:00Z' + n * interval '1 minute' AS performed_at
    FROM generate_series(0, 49999) AS n
  ), actual AS (
    SELECT user_id::text, exercise_id, performed_at FROM workout_entries
  ), difference AS (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) SELECT count(*) INTO mismatches FROM difference;
  IF mismatches <> 0 THEN
    RAISE EXCEPTION 'Entry user/exercise/timestamp/grouping mismatch: %', mismatches;
  END IF;

  WITH expected AS (
    SELECT 'csv-benchmark'::text AS user_id,
      '10000000-0000-4000-8000-000000000001'::uuid AS exercise_id,
      timestamptz '2026-01-01T00:00:00Z' + n * interval '1 minute' AS performed_at,
      p AS position, 4 + p AS reps,
      CASE p WHEN 1 THEN 135::numeric WHEN 2 THEN 60::numeric ELSE 0::numeric END AS original_weight,
      CASE p WHEN 1 THEN 'lb'::text ELSE 'kg'::text END AS original_unit,
      CASE p WHEN 1 THEN 135::numeric * 0.45359237::numeric
        WHEN 2 THEN 60::numeric ELSE 0::numeric END AS weight_kg
    FROM generate_series(0, 49999) AS n CROSS JOIN generate_series(1, 3) AS p
  ), actual AS (
    SELECT e.user_id::text, e.exercise_id, e.performed_at,
      s.position, s.reps, s.original_weight, s.original_unit, s.weight_kg
    FROM workout_sets s LEFT JOIN workout_entries e ON e.id = s.entry_id
  ), difference AS (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) SELECT count(*) INTO mismatches FROM difference;
  IF mismatches <> 0 THEN
    RAISE EXCEPTION 'Exact set fields/entry membership mismatch: %', mismatches;
  END IF;
  IF (SELECT count(DISTINCT id) FROM workout_entries) <> 50000
    OR (SELECT count(DISTINCT id) FROM workout_sets) <> 150000
    OR EXISTS (SELECT 1 FROM workout_entries e CROSS JOIN workout_imports i
      WHERE e.created_at < i.created_at::timestamptz(3)
        OR e.created_at > i.updated_at::timestamptz(3)) THEN
    RAISE EXCEPTION 'Generated identity or creation timestamp mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'csv_benchmark_failure')
    OR to_regprocedure('csv_benchmark_failure()') IS NOT NULL
    OR to_regclass('csv_benchmark_failure_attempts') IS NOT NULL THEN
    RAISE EXCEPTION 'Fault injection objects were not cleaned up';
  END IF;
  RAISE NOTICE 'VERIFIED: 50000 exact entries, 150000 exact sets, 500 completed batches, 1 retry';
END $check$;
COMMIT;
