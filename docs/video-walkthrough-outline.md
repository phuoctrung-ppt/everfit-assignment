# English video walkthrough — 19 minutes

Status: recording outline prepared. **The required 15–20-minute English recording has not been supplied.** Add its accessible URL or file reference to the delivery handoff after recording and checking playback. An outline is not a video submission.

## Preparation

- Follow the [README startup](../README.md) on a dedicated local instance. Finish image builds before recording; briefly show the startup command and healthy services.
- Keep terminals, API responses, and these source files ready. Hide `.env`, database URLs, personal configuration, and unrelated windows.
- Use the seeded Bench Press catalog entry. Choose a new demo user for each take; all requests below use the same user. The script creates synthetic workout data.
- Run `pnpm smoke --base-url http://localhost:3000` before recording, using the actual mapped API port. Review [delivery verification](delivery-verification.md) and distinguish current results from the earlier benchmarks.
- Open Swagger only in a development instance. The production Compose service intentionally disables `/docs` and `/docs-json`.

## 0:00–3:00 — Problem, architecture, and schema

**0:00–0:45:** “This API lets coaches log workouts, browse a client's history, and compare personal records. The assignment excludes authentication; the supplied user ID selects data but does not establish identity.” State NestJS, PostgreSQL, and Docker Compose.

**0:45–1:45:** Show the README architecture diagram. Follow controller → service → repository → PostgreSQL. Explain Zod validation, decimal conversion shared across features, and bounded database connections. PostgreSQL provides atomic bulk transactions, relational constraints, and SQL record selection. Direct `pg` keeps transaction and query behavior visible.

**1:45–3:00:** Open [migration 001](../migrations/001-workout-schema.cjs): exercises, muscle groups, mapping, workout entries, ordered sets, and idempotency requests. Explain original weight/unit plus exact normalized kg; user/date/ID history and user/exercise/date indexes. Mention UTC `[from, to)` ranges and newest-first history.

## 3:00–9:00 — Live API and edge cases

Set a fresh demo identity and request body:

```sh
export DEMO_BASE_URL=http://localhost:3000
export DEMO_USER="video-$(date +%s)"
export DEMO_WORKOUT='{"date":"2026-01-15T08:00:00Z","exerciseName":"Bench Press","sets":[{"reps":5,"weight":135,"unit":"lb"}]}'
```

**3:00–3:45 — Readiness and catalog:**

```sh
curl -sS "$DEMO_BASE_URL/health"
curl -sS "$DEMO_BASE_URL/exercises?muscleGroup=chest&limit=1"
```

Point out readiness, normalized muscle-group filtering, complete group metadata, and the cursor envelope.

**3:45–5:00 — Write, replay, conflict:**

```sh
curl -sS -i -X POST "$DEMO_BASE_URL/users/$DEMO_USER/workout-entries" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: video-january' \
  -d "$DEMO_WORKOUT"
# Repeat exactly: 201, deeply equal body and IDs, fresh x-request-id.
curl -sS -i -X POST "$DEMO_BASE_URL/users/$DEMO_USER/workout-entries" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: video-january' \
  -d "$DEMO_WORKOUT"
# Reuse the key with a changed payload: 409.
curl -sS -i -X POST "$DEMO_BASE_URL/users/$DEMO_USER/workout-entries" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: video-january' \
  -d '{"date":"2026-01-15T08:00:00Z","exerciseName":"Bench Press","sets":[{"reps":6,"weight":135,"unit":"lb"}]}'
```

Show `61.2350 kg`, preserved `135.000000 lb`, and explain exact internal `61.23496995000000 kg`. Replay promises JSON content/status equality, not byte order.

**5:00–6:00 — Atomic bulk and validation:**

```sh
# Valid first item plus unknown exercise: 400; neither item is saved.
curl -sS -i -X POST "$DEMO_BASE_URL/users/$DEMO_USER/workout-entries/bulk" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: video-bulk' \
  -d '{"entries":[{"date":"2026-02-15T08:00:00Z","exerciseName":"Bench Press","sets":[{"reps":8,"weight":70,"unit":"kg"}]},{"date":"2026-02-15T08:00:00Z","exerciseName":"Unknown Video Exercise","sets":[{"reps":5,"weight":0,"unit":"kg"}]}]}'
# Corrected bulk reuses the rolled-back key: 201.
curl -sS -i -X POST "$DEMO_BASE_URL/users/$DEMO_USER/workout-entries/bulk" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: video-bulk' \
  -d '{"entries":[{"date":"2026-02-15T08:00:00Z","exerciseName":"Bench Press","sets":[{"reps":8,"weight":70,"unit":"kg"}]}]}'
```

Show indexed error path, whole-request rollback, and that failed validation does not consume a key. Point to the smoke script for additional malformed-input assertions.

**6:00–7:15 — History, pagination, empty ranges:**

```sh
curl -sS --get "$DEMO_BASE_URL/users/$DEMO_USER/workout-entries" \
  --data-urlencode 'exerciseName=bench' --data-urlencode 'muscleGroup=chest' \
  --data-urlencode 'unit=lb' --data-urlencode 'limit=1'
# Copy nextCursor; resend it with the same user, filters, and unit.
curl -sS --get "$DEMO_BASE_URL/users/$DEMO_USER/workout-entries" \
  --data-urlencode 'from=2030-01-01T00:00:00Z' \
  --data-urlencode 'to=2030-02-01T00:00:00Z'
```

Show all sets remain together, bounded page size, stable date/UUID ordering, and the successful empty response. Explain cursor binding and that traversal is not a snapshot.

**7:15–9:00 — Personal records and period comparison:**

```sh
curl -sS --get "$DEMO_BASE_URL/users/$DEMO_USER/personal-records" \
  --data-urlencode 'exerciseName=Bench Press'
curl -sS --get "$DEMO_BASE_URL/users/$DEMO_USER/personal-records/compare" \
  --data-urlencode 'exerciseName=Bench Press' \
  --data-urlencode 'baselineFrom=2026-01-01T00:00:00Z' \
  --data-urlencode 'baselineTo=2026-02-01T00:00:00Z' \
  --data-urlencode 'comparisonFrom=2026-02-01T00:00:00Z' \
  --data-urlencode 'comparisonTo=2026-03-01T00:00:00Z'
```

Explain independent winners for weight, volume, and Epley `weight × (1 + reps / 30)`; show dates and positive differences. February's heaviest set is `70.0000 kg`, volume `560.0000 kg*reps`, estimated 1RM `88.6667 kg`. An absent period produces null differences; zero-weight records remain real records.

## 9:00–12:00 — AI workflow and corrections

**9:00–9:45:** Open [AI_WORKFLOW](../AI_WORKFLOW.md), `AGENTS.md`, and a focused test. Explain assignment context → explicit decisions → phased tasks → independent review → commands. Describe actual Codex/subagent use, not tools merely installed.

**9:45–10:45:** Explain the checked-out-client error correction and guarded URL parsing correction. Show tracked source/regression links from the evidence ledger. Historical failing output is not preserved in Git; do not present a fresh green run as proof of a historical red cycle.

**10:45–11:30:** Show rejected independent retries and the accepted persistent key protocol. Distinct keys still permit legitimate repeated workouts.

**11:30–12:00:** Show the benchmark fixture correction or query performance miss, then the recorded measured result. Explain why a second user's deliberately different data matters. Local plan reports are Git-excluded; tracked tests and summary documents travel with the repository.

## 12:00–16:00 — Explain selected code line by line

- **12:00–13:30:** [WorkoutLoggingService.log](../src/modules/workouts/workout-logging.service.ts): validation/fingerprint; one READ COMMITTED transaction; reserve then separate replay read; resolve names; batched inserts; validate/store response; return only after commit. Explain 409 and sanitized 503 without automatic write retry.
- **13:30–14:15:** [DatabaseService.withTransaction](../src/database/database.service.ts): checked-out client listener, BEGIN/COMMIT, rollback, damaged-client discard, release, shutdown pool close. Point out the regression that terminates its own backend.
- **14:15–15:00:** [WorkoutHistoryRepository](../src/modules/workouts/workout-history.repository.ts): parameterized conditions, literal LIKE escaping, EXISTS for groups, tuple cursor, `limit + 1`, bounded second set query.
- **15:00–16:00:** [SELECT_RECORD_WINNERS_SQL](../src/modules/personal-records/personal-records.repository.ts) and [record calculations](../src/modules/personal-records/record-calculations.ts): exact Epley numerator, deterministic ties, one statement snapshot across periods, subtract before rounding. Explain the actual-array-length limit and measured optimizer correction.

## 16:00–19:00 — 10,000 concurrent coaches and handoff

**16:00–16:45:** Define workload before capacity: connected coaches are not requests/second. As an illustration only, one request every ten seconds from each coach is 1,000 requests/second before bursts. Establish read/write mix, clients per coach, bulk sizes, peak bursts, growth, and latency/error objectives. Current loopback concurrency-1 read measurements and finite bulk soak do not establish this capacity.

**16:45–17:30:** Add authenticated coach/client authorization and tenant isolation, rate limits, TLS, managed secrets, backups with restore exercises, and measured observability. Explain bounded queues/timeouts/backpressure, database connection budgets across all API replicas, and load tests that include database resources and sustained traffic.

**17:30–18:15:** Scale stateless API replicas behind a load balancer; retain shared PostgreSQL idempotency coordination. Tune query plans/indexes and total pool capacity from representative measurements. Define retention/archival for indefinitely stored idempotency responses. Account for deployment migrations and draining active requests.

**18:15–18:45:** Consider read replicas only with explicit lag/read-after-write handling. Add caches only with tenant/filter/unit keys and invalidation rules. Precomputed records must still handle arbitrary ranges and ties; consider them after measurements show need. Larger data may justify partitioning, but current evidence does not select a partition key or prove benefit.

**18:45–19:00:** Show tests and measured performance links, state limitations, and show the repository/video delivery location once actually supplied. Confirm playback duration and accessible permissions before submission.
