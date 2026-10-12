-- Read-only inspection after the benchmark/API processes stop.
-- Run with psql -v ON_ERROR_STOP=1 against the retained benchmark database.
BEGIN READ ONLY;

SELECT current_database() AS database, user_id, count(*) AS entries,
       count(DISTINCT performed_at) AS distinct_workout_dates
FROM workout_entries GROUP BY user_id;
SELECT count(*) AS sets FROM workout_sets;
SELECT user_id, response_status, count(*) AS committed_batches
FROM idempotency_requests GROUP BY user_id, response_status;

DO $check$
DECLARE
  mismatches bigint;
BEGIN
  IF current_database() !~ '^everfit_test_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Expected isolated test database';
  END IF;
  IF (SELECT count(*) FROM workout_entries) <> 50000
     OR (SELECT count(*) FROM workout_sets) <> 150000
     OR (SELECT count(*) FROM idempotency_requests) <> 500 THEN
    RAISE EXCEPTION 'Incorrect entry/set/batch count';
  END IF;

  -- Independent SQL oracle derived from the documented deterministic input.
  WITH expected AS (
    SELECT n, timestamptz '2026-01-01T00:00:00Z' + n * interval '1 minute' AS date,
      ('10000000-0000-4000-8000-' || lpad((n % 4 + 1)::text, 12, '0'))::uuid AS exercise
    FROM generate_series(0, 49999) AS n
  )
  SELECT count(*) INTO mismatches FROM expected x
  FULL JOIN workout_entries e ON e.performed_at = x.date
  WHERE x.n IS NULL OR e.id IS NULL OR e.user_id <> 'performance-primary'
    OR e.exercise_id <> x.exercise;
  IF mismatches <> 0 OR
     (SELECT count(DISTINCT performed_at) FROM workout_entries) <> 50000 THEN
    RAISE EXCEPTION 'Entry identity/user/exercise/date mismatch';
  END IF;

  SELECT count(*) INTO mismatches FROM workout_entries e
  CROSS JOIN generate_series(1, 3) AS g(position)
  LEFT JOIN workout_sets s ON s.entry_id = e.id AND s.position = g.position
  WHERE s.id IS NULL OR s.reps <> CASE
      WHEN e.performed_at = timestamptz '2026-01-01T00:00:00Z' + 33349 * interval '1 minute'
        AND g.position = 2 THEN 9999 ELSE 4 + g.position END
    OR s.original_weight <> CASE g.position WHEN 1 THEN 135 WHEN 2 THEN 60 ELSE 0 END
    OR s.original_unit <> CASE g.position WHEN 1 THEN 'lb' ELSE 'kg' END
    OR s.weight_kg <> CASE g.position WHEN 1 THEN 61.23496995000000
      WHEN 2 THEN 60.00000000000000 ELSE 0.00000000000000 END;
  IF mismatches <> 0 THEN
    RAISE EXCEPTION 'Set position/reps/original/normalized weight mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM idempotency_requests
    WHERE user_id <> 'performance-primary' OR response_status IS DISTINCT FROM 201
      OR response_body IS NULL OR jsonb_array_length(response_body->'data') IS DISTINCT FROM 100) THEN
    RAISE EXCEPTION 'Incomplete or incorrect committed replay response';
  END IF;
  SELECT count(*) INTO mismatches FROM idempotency_requests r
  CROSS JOIN LATERAL jsonb_array_elements(r.response_body->'data') AS item
  LEFT JOIN workout_entries e ON e.id = (item->>'id')::uuid
  WHERE e.id IS NULL OR r.user_id <> e.user_id OR r.key <>
    'retained-batch-' || (floor(extract(epoch FROM
      (e.performed_at - timestamptz '2026-01-01T00:00:00Z')) / 6000)::int + 1)::text;
  IF mismatches <> 0 OR (SELECT count(DISTINCT item->>'id')
    FROM idempotency_requests r
    CROSS JOIN LATERAL jsonb_array_elements(r.response_body->'data') AS item) <> 50000 THEN
    RAISE EXCEPTION 'Replay batch mapping or duplicate entry mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'benchmark_record_failure') THEN
    RAISE EXCEPTION 'Fault injection trigger was not cleaned up';
  END IF;
  RAISE NOTICE 'VERIFIED: 50000 entries, 150000 exact sets, 500 committed batches';
END $check$;

COMMIT;
