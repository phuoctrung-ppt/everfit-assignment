# Actual CSV upload: 50,000 entries

Verified 2026-10-12 on local PostgreSQL with a real multipart file upload, a
separate API process and one separate import worker. Earlier JSON bulk results
are a different test; they did not exercise CSV ingestion.

## Reproduce

A tracked copy of the exact benchmark file is available at
[data/workouts-50000.csv](../data/workouts-50000.csv): 50,000 entries,
150,000 set records plus one header. Its SHA-256 matches the measured run below.

```bash
pnpm test:performance:csv --retain-database \
  --output=artifacts/performance/csv-import-retained.json
```

Requires PostgreSQL and `TEST_DATABASE_ADMIN_URL` with permission to create/drop
isolated `everfit_test_<32 hex>` databases. Runner migrates/seeds its own database;
no shared development data is altered. Omit `--retain-database` for automatic
cleanup. Never put credentials in report files or tracked documentation.

## Observed result

| Measurement                           |            Result |
| ------------------------------------- | ----------------: |
| File bytes                            |         8,816,726 |
| CSV data records / workout entries    |  150,000 / 50,000 |
| Committed batches                     | 500 × 100 entries |
| Upload acknowledgement                |            315 ms |
| Worker startup + validation + import  |          17.669 s |
| Upload through observed completion    |          18.005 s |
| Worker throughput                     |   2,830 entries/s |
| Worker CPU through final sample       |           6.140 s |
| Sampled worker peak RSS               |        315.08 MiB |
| OS high-water RSS observed            |        320.45 MiB |
| Injected transient failures / retries |             1 / 1 |
| Final persisted entries / sets        |  50,000 / 150,000 |

Node v24.21.0, Linux, Intel i5-1135G7. Runner PID 127279, API PID 127340,
worker PID 127374. API restart used PID 127726; worker exited cleanly with code 0.
RSS is sampled every 100 ms. CPU/RSS cover only the worker, excluding PostgreSQL,
API and runner. Completion/staging use status polling. Local single-run evidence,
not a production capacity or endurance guarantee.

## What establishes persistence

1. Runner saves a real CSV artifact, then uploads its bytes using FormData.
   API returns 202 and a queued job. Direct SQL confirms **zero workout rows**
   before the import worker starts.
2. An isolated-test trigger raises SQLSTATE `40001` at entry index 25,000.
   A nontransactional sequence records two attempts. Final job reports one retry,
   500 completed batches, 50,000 processed entries and 150,000 processed sets.
3. [Independent SQL oracle](../test/performance/verify-csv-import.sql) generates
   expected entries/sets with `generate_series` and checks `EXCEPT ALL` in both
   directions. This catches missing/extra/duplicate/wrong rows, including owner,
   exercise ID, timestamp, entry membership, set position, reps, original weight,
   original unit and exact normalized weight. It checks generated identities,
   creation timestamps, job progress, source/staging cleanup and fault cleanup.
4. Restart API and upload the same file/key. Same completed job is returned;
   fingerprints of all stored columns and IDs remain identical, and the full
   SQL oracle passes again.
5. After API and worker stop, a separate `psql` invocation runs the read-only SQL
   oracle again against the retained database. It confirms the same exact data.

Retained database: `everfit_test_728bcca366a84c7ea736657e284b5b9e`.
User: `csv-benchmark`. Import ID: `11be19fb-b0e2-45af-a21b-99bdffad6164`.
CSV SHA-256: `3d5470150ff170a4d1abcb8ff4534e3eff0d5262828a4cc303b553fe514c1361`.

Local evidence (Git-ignored):

- [JSON report](../artifacts/performance/csv-import-retained.json)
- [Uploaded CSV](../artifacts/performance/csv-import-retained.json.csv)
- [Independent psql output](../artifacts/performance/csv-import-psql.txt)

With connection settings targeting the retained database:

```bash
psql -X -v ON_ERROR_STOP=1 -f test/performance/verify-csv-import.sql
```

## Other failure cases

PostgreSQL integration tests cover invalid final record (zero workout writes),
unknown exercise, both batch limits, transient failure after set inserts,
three-attempt exhaustion, permanent failures preserving prior batches, same-key
concurrent uploads, worker exclusion and catalog renames. A separate process test
SIGKILLs a worker in its second batch: exactly the first 100 entries remain
visible; a new worker resumes and finishes 201 entries without duplicates.

An invalid record is rejected, not silently skipped or repeatedly retried.
Correct a validation-only failed file and submit a new key. Runtime failures
with committed batches require reconciliation before a new-key full-file upload;
see [import semantics](csv-import-design.md).

Final checks: 386 unit tests and 285 PostgreSQL integration tests passed; build,
ESLint/Prettier and TypeScript checks passed.
