# Retained 50,000-entry batch/retry benchmark

This command writes exactly **50,000 workout entries / 150,000 sets** for
`performance-primary` through the real bulk HTTP API. One benchmark process
submits **500 sequential batches of 100 entries**, while the compiled Nest API
runs in a separate child process. Their PIDs are printed and recorded. This is
a test runner, not a production background queue or a CSV upload implementation.

```sh
docker compose up postgres -d --wait
pnpm test:performance:batch-retry --retain-database --output artifacts/performance/batch-retry-retained.json
```

Requires the existing `.env` with `TEST_DATABASE_ADMIN_URL` pointing to a dedicated
local/test server. The command builds the API and creates/migrates/seeds its own
random `everfit_test_<32 hex>` database. No workout rows are inserted directly by
the seed: all 50,000 entries pass through HTTP. The normal development database
is unchanged. Report contains the generated database name, never its credentials.

Omit `--retain-database` to drop the generated database after the run. With the
flag, data remains on success **or failure**; inspect `status` and `failures`
before treating it as verified. API processes and DB clients still close. A new
invocation creates a new database, so it does not overwrite a previous dataset.

## Failure and retry cases

The API's existing bulk contract remains atomic: one invalid record rejects its
entire batch. Retry logic lives only in the benchmark client; server writes do
not acquire automatic retries.

| Case | Expected behavior and proof |
| --- | --- |
| Batch 167, entry 50: unknown exercise | HTTP400; all prior 16,600 entries/49,800 sets/166 keys unchanged. The harness explicitly restores the known fixture's exercise and resubmits the whole batch with the same key. HTTP201 commits exactly100 entries. Invalid data is not blindly retried or silently dropped. |
| Batch 334, entry 50, set2: transient SQL error | Test-only PostgreSQL AFTER INSERT trigger raises SQLSTATE55P03 once. Sequence evidence survives transaction rollback and proves rows were visible inside the failed transaction. Independent queries before retry confirm only the prior33,300 entries/99,900 sets/333 keys remain, with their exact content intact. |
| Automatic retry of batch334 | Client retries only HTTP503, at most3 total attempts, exponential delays100/200ms. Payload bytes and idempotency key stay unchanged. The injected failure recovers on attempt2. HTTP400/409/500 and network failures are not automatically retried. Abort cancels pending backoff. |
| Restart and replay | Stop the original API process; query the DB with an independent pool; start a new API PID; replay batch334 with the same key. Response IDs/content match and counts stay50,000/150,000/500. |

Load phase makes **502 HTTP attempts**: 500 successes, one400, one503. Restart
replay adds one more request without extra rows. The trigger and its diagnostic
sequences/function are removed before leaving the database for inspection.

## Verification and measurements

The existing bigint oracle checks every entry/set against inputs plus acknowledged
IDs/timestamps: owner, exercise ID/name, dates, set identity/order/reps, original
weights/units, and exact14-decimal kg. Counts alone are insufficient. Complete
content checks run at failed-batch checkpoints, at the end, and after API restart.
No committed incomplete idempotency row is allowed.

The report records per-attempt status and time until HTTP headers, complete batch
latencies, load duration, entries/s, API CPU, sampled API RSS and pool state.
Batch timings include response reading/validation and, for failure batches,
rollback SQL checks, injection setup/cleanup and backoff. Total load throughput
includes runner work. Final full verification and API restart are outside the
load measurement. PostgreSQL and benchmark-parent resources are not included in
API CPU/RSS. There is no separate warmup for this one-pass dataset load.
On failure the report preserves completed attempts, timings and available recovery
checkpoints, with a sanitized failure category/stage. Raw database errors and
credentials are omitted. Fault-control connections have bounded connection,
query, statement and lock timeouts.

Preselected local screening budgets: batch p95≤1,000ms, API CPU≤100ms per batch,
sampled API RSS≤512MiB; all correctness failures also fail the command. These
are diagnostic limits, not production SLOs. Raw attempt timings and rollback
evidence remain in the JSON report, including the injected failures.

## Inspect the retained database after processes stop

For the local Compose server used by `TEST_DATABASE_ADMIN_URL`, discover the
database name from the report and run an independent SQL count:

```sh
BATCH_DATABASE=$(node -p "require('./artifacts/performance/batch-retry-retained.json').databaseName")
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$1" -c "SELECT e.user_id, count(DISTINCT e.id) AS entries, count(s.id) AS sets FROM workout_entries e LEFT JOIN workout_sets s ON s.entry_id=e.id GROUP BY e.user_id"' sh "$BATCH_DATABASE"
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$1" -c "SELECT user_id, count(*) AS committed_batches FROM idempotency_requests WHERE response_status=201 GROUP BY user_id"' sh "$BATCH_DATABASE"
# Full independent SQL assertions; exits nonzero on any mismatch:
docker compose exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$BATCH_DATABASE" < test/performance/verify-batch-retry.sql
```

Expected: `performance-primary`, **50,000 entries /150,000 sets /500 batches**.
Use that database name in DBeaver/pgAdmin with the same host/port/credentials as
`TEST_DATABASE_ADMIN_URL`. For a non-Compose server use your existing SQL client.
Only remove a retained database once you no longer need its inspection evidence.

Focused automated checks (small real DB workload and retry policy):

```sh
pnpm test:unit --runInBand test/performance/retry-transport.spec.ts
pnpm test:integration --runInBand test/batch-retry.integration-spec.ts
```

## Recorded run

Executed **2026-10-12 03:29:05–03:29:32 UTC**, status `passed`, no budget or
correctness failures. Node v24.21.0; PostgreSQL17.11; Linux x64; Intel i5-1135G7.
Runner PID79453; original API PID79497; restarted API PID79946. All three were
stopped before the subsequent external SQL verification.

| Measurement | Observed |
| --- | ---: |
| Load duration, including recovery checks/backoff | 22.379s |
| Throughput | 2,234.29 entries/s |
| Batch p50 / p95 | 33.77 /61.07ms |
| API total CPU /CPU per batch | 7,141.40ms /14.28ms |
| Peak sampled API RSS | 218.52MiB |
| Load HTTP attempts | 502:500×201,1×400,1×503 |
| Final entries /sets /committed keys | 50,000 /150,000 /500 |
| Restart replay | Identical response; counts and exact content unchanged |

The failed SQL transaction saw33,400 entries/100,200 sets before raising the
exception; independent queries after rollback saw33,300/99,900 and333 keys.
The retry succeeded on its second attempt with a100ms scheduled backoff.

Retained database: **`everfit_test_e487b31f6d634121b12f11e7f32b5f95`**.
The independent `psql` script then checked all50,000 expected dates/exercises,
all150,000 exact set values and500 replay-batch mappings inside a read-only
transaction. It exited0 with:

```text
VERIFIED: 50000 entries, 150000 exact sets, 500 committed batches
```

Local evidence: [JSON report](../artifacts/performance/batch-retry-retained.json)
and [external SQL output](../artifacts/performance/batch-retry-psql.txt).
Artifacts are Git-ignored; the runnable sources and this summary preserve the
methodology. The database remains available until explicitly removed; its name
is local evidence, not a portable fixture name. Later edits to retained data can
invalidate the original report, so rerun the SQL script when inspecting it.

Final verification: **275 unit tests /269 PostgreSQL integration tests passed**;
lint and TypeScript passed. Independent review closed both failure-path findings
after bounded SQL timeouts and partial-progress reporting were added. The
recorded successful benchmark predates those failure-path-only refinements;
the full regression suite was rerun afterward.
