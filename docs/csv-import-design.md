# CSV upload and one import worker

Implemented: `POST /users/:userId/workout-entries/bulk/csv` accepts multipart
field `file` and `Idempotency-Key`. It returns **202** with `{data: {id, status,
...}}` after the exact file and job are durably stored in PostgreSQL. Poll
`GET /users/:userId/workout-entries/imports/:importId` until `completed` or `failed`.
202 means queued, not that workouts have been saved.

Existing `POST .../bulk` continues to accept JSON, returning 201 after an atomic
request of at most 100 entries and 1,000 sets. Previous bulk benchmark reports
measure JSON HTTP requests; they do not demonstrate CSV upload.

## Running

Apply migration `004-csv-imports.cjs` with `pnpm db:migrate`, build, then run
`pnpm start` and `pnpm start:import-worker` in separate terminals. Docker Compose
starts the `import-worker` service alongside the API after migration/seed.
The worker holds a PostgreSQL session advisory lock on its dedicated connection;
a second active worker for the same database exits unsuccessfully. API processes
can enqueue jobs while no worker is running; the queue survives API restarts.

```bash
curl -X POST http://localhost:3000/users/athlete-1/workout-entries/bulk/csv \
  -H 'Idempotency-Key: training-csv-001' \
  -F 'file=@workouts.csv;type=text/csv'

curl http://localhost:3000/users/athlete-1/workout-entries/imports/IMPORT_UUID
```

Swagger documents the file upload. Filenames and client MIME labels are not used
as paths or trusted as validation. CSV content is validated by the worker.
User IDs are validated and status queries are scoped by user ID. Authentication
remains outside assignment scope; route scoping is not authentication.

## File contract

One logical record per set; exact ordered header:

```csv
entryRef,date,exerciseName,setPosition,reps,weight,unit
w1,2026-01-01T08:00:00.000Z,Bench Press,1,8,135,lb
w1,2026-01-01T08:00:00.000Z,Bench Press,2,6,60,kg
w2,2026-01-02T08:00:00.000Z,Squat,1,5,80,kg
```

50,000 workout entries with three sets each means **150,000 data records** in the
CSV, plus the header. `entryRef` groups contiguous rows; it uses 1–128 ASCII
letters, digits, underscores or hyphens. Each group has identical date/exercise,
positions 1 through N without gaps, and at most 100 sets. A closed reference
cannot appear again. Different references may intentionally describe identical
workouts. References are local to a file, not persisted workout IDs.

Limits: one file, 32 MiB, 50,000 entries, 150,000 sets, 64 KiB per logical parser
record. No additional multipart fields. UTF-8 (optional BOM), LF/CRLF, quoted
commas/newlines and escaped quotes are supported by `csv-parse` 7.0.3. Reject
invalid UTF-8/NUL, blank records, unexpected headers/columns, empty/header-only
files, unknown exercises and values rejected by shared workout schemas.
Reps/positions are positive integer text. Weight is nonnegative decimal text
with at most six fractional digits. Scientific notation, surrounding numeric
whitespace, Infinity and coercible empty values are rejected. Dates use the
existing UTC contract. Units are `kg` or `lb`.

## Processing and recovery

1. API bounds the in-memory multipart file, hashes exact bytes (SHA-256), and
   stores a `bytea` source with the job in one transaction. No shared filesystem,
   external queue, Redis or orphaned file reservation is required.
2. Worker validates the **entire file** and stages bounded JSON batches in one
   transaction, pinning exercise IDs. No workouts are written during validation.
   If the final row is invalid, staged rows roll back and the job fails with zero
   workouts. A successful validation clears the original source and sets totals.
3. Worker applies one batch (≤100 entries **and** ≤1,000 sets) per transaction.
   Catalog row locks and ID checks detect remapping after staging. Inserts,
   removal of the staged batch and progress update commit together. Completion
   means all expected batches committed, with exact entries/sets counters.
4. A crash rolls back the current batch. A replacement worker acquires the
   released session lock and resumes from the remaining staged batches. Attempts
   are durably counted before each step, including interrupted attempts.
5. SQL serialization/deadlock/lock-timeout/statement-timeout errors retry up to
   three attempts per step with 100/200 ms delay. Successful steps reset attempts;
   `retryCount` accumulates scheduled retries. Broken connections end the worker;
   restart the process to resume. Permanent errors do not retry automatically.

A failed job returns a sanitized `error` with code, logical data `record` (header
excluded), field and message when available. SQL failures have no raw database
message or input values. Earlier committed batches remain visible if a later
batch fails; the whole import is **not** one atomic workout transaction.
`processedEntries`, `processedSets`, `completedBatches` describe this partial
result. There is no automatic skip of an invalid record.

A retry with the same user/key and exact bytes returns the existing job, including
terminal status. Different bytes with the same key return 409. For a validation
failure (zero writes), correct the file and use a new key. For a runtime failure
after partial commits, reconcile committed data before uploading with a new key;
blindly replaying the whole file under a new key can duplicate prior batches.
CSV keys occupy a separate namespace from existing JSON logging keys.

## Resource and retention trade-offs

Multipart files are bounded but buffered in API memory; simultaneous uploads
multiply that memory cost. The worker parses chunks without materializing all
CSV rows, but retains the source buffer during validation. PostgreSQL stores
queued source bytes and staged batches and therefore bears queue storage/WAL
cost. Source/staging are removed on completion or terminal failure; job metadata
and idempotency hashes remain. There is no automatic metadata expiry, upload
rate limit, production capacity claim, or worker auto-restart policy.

## Verification

`pnpm test:unit --runInBand` covers strict parser formatting, values and exact
50,000-entry/150,000-set boundaries. PostgreSQL integration tests upload actual
multipart files, verify bytes and stored values, exercise idempotency, full-file
validation, both batch limits, catalog changes, retry exhaustion and rollback.
A process test SIGKILLs a worker while the next batch is blocked in SQL, checks
that only the prior committed batch is visible, then starts a new worker and
checks completion without duplicates.

```bash
pnpm test:performance:csv --retain-database \
  --output=artifacts/performance/csv-import-retained.json
```

The benchmark generates a real CSV file, uploads it to a separate API process,
starts a separate import worker, injects one transient record failure and verifies
all 50,000 entries/150,000 sets with independent SQL. See its report for measured
latency, process IDs and retained database name; credentials are never recorded.
