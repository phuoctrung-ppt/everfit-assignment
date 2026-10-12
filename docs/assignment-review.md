# Assignment review — 2026-10-12

Reviewed [Backend Engineer.pdf](../Backend%20Engineer.pdf), application source,
migrations, tests, and delivery documentation. Baseline commit `54bec35` plus the
existing working tree; pre-existing edits were preserved. Delegated reviewers
covered requirements and persistence/error changes. This is a bounded code review
with fresh runtime evidence, not a proof that no defects remain.

## Findings and changes

| Priority | Finding | Resolution |
| --- | --- | --- |
| P2 | HTTP filter replaced safe validation reasons with `Invalid value`, hiding unknown exercises and reversed ranges. | Preserve four exact application-owned custom messages. Arbitrary/custom input, unknown fields and pagination remain sanitized. Regression tests cover malicious values and future untrusted messages. |
| P2 verification gap | Bulk benchmark checked public responses and database counts, which could miss wrong persisted values. | Independently compute expected exact values from inputs; compare every stored entry/set after seed and at the end, including IDs/relationships and timestamps. |
| P2 verification gap | Existing basic persistence checks did not compare every column across heterogeneous users/exercises and restart/replay. | Separate `pg.Client` checks complete entry/set/idempotency tables and immutable replay after replacing the application and pool. |
| P3 documentation | Bulk methodology still described read benchmarks as future work. | Link existing read methodology and fresh results below. |

No P0/P1 implementation defect identified in this review. No persistence schema,
logging limits, PR formula, pagination contract, or dependency change was needed.

## Assignment coverage

| Requirement | Implementation and verification |
| --- | --- |
| Single/bulk writes; kg/lb; originals + normalized kg | Parameterized batched writes inside one transaction; exact NUMERIC expectations, heterogeneous exercises/sets and all persisted columns checked. |
| History by user/name/date/muscle; requested units; pagination | Composed SQL filters, literal partial search, stable date/UUID cursor, unit conversion; integration and fresh large-data read benchmark. |
| Heaviest, volume and Epley PRs; achieved dates; comparisons | SQL ranks exact canonical values; independent metric winners, ties, UTC ranges and period comparisons covered by existing tests and read oracle. |
| Invalid fields/units; empty ranges; timezone strategy | Strict Zod contracts, empty 200 response with message, documented UTC-only inputs and half-open ranges; safe specific validation reasons added. |
| Concurrent writes/retries | User/key uniqueness, durable replay, atomic rollback; existing ten-client/two-app and commit-failure integration tests rerun. Distinct keys permit intentional identical workouts. |
| 50,000+ entries per user | 51,000 primary entries loaded through HTTP bulk; separate 50,000-entry read dataset; measured results below. |
| Extensible units / configurable muscle mapping | Shared unit registry and conversion module; external catalog JSON plus DB mapping. Minor maintenance note: volume response units also need extension when introducing a new weight unit. |
| Node/Nest/PostgreSQL, schema/index rationale, no auth | Implemented and documented; supplied user IDs select data without authenticating identity. |
| Docker/logging/configuration | Existing Compose/migration/seed setup and structured logging; this review started PostgreSQL via Compose and ran compiled API children. Full clean Docker delivery was not repeated. |
| AI workflow, iterative commits, estimate, video/repository | Existing AI ledger and iterative commit history reviewed; 22.5-hour estimate documented. Video/public repository handoff remains outside this test run. |

## Reproduce

Requires installed project dependencies and `.env` with a dedicated local/test
`TEST_DATABASE_ADMIN_URL` whose role can create/drop databases.

```sh
docker compose up postgres -d --wait
pnpm test:integration --runInBand test/workout-persistence.integration-spec.ts test/persistence-oracle.integration-spec.ts test/validation-messages.integration-spec.ts
pnpm test:unit --runInBand
pnpm test:integration --runInBand
pnpm lint
pnpm exec tsc --noEmit
pnpm build
PERF_LOG_LEVEL=silent PERF_REPORT=artifacts/performance/bulk-assignment-review.json pnpm test:performance:bulk
pnpm test:performance --create-isolated --entries 50000 --sets-per-entry 3 --seed 42 --output artifacts/performance/reads-assignment-review.json
```

Tests create/drop only randomly named `everfit_test_<32 hex>` databases. No test
cleans the development database. The PostgreSQL service remains running for local
use; generated test/benchmark databases are removed. For caller-owned benchmark
databases, see [the read benchmark instructions](read-performance.md).

## Verification evidence

Baseline: **244 unit tests, 239 integration tests passed** before changes.
Final: **244 unit tests (17 suites), 267 integration tests (31 suites) passed**;
28 integration cases added. `pnpm lint`, `pnpm exec tsc --noEmit`, and both
benchmark commands (each includes `pnpm build`) exited 0. `git diff --check`
also passed. Independent review found no substantive issue in the validation
patch. Two CSV proposal gaps were corrected: serialize orphan cleanup with job
attachment, and preserve validated exercise identity across batches. They were
design issues, not implemented CSV defects.
Final independent static review found no substantive issue in the persistence
oracle, its benchmark integration, or the corrected CSV proposal. Oracle IDs and
creation timestamps are matched to acknowledged responses; input fields and
exact weight arithmetic are independent. Parent digest work can affect pacing
and concurrent latency, as documented in the bulk methodology.

The added oracle tests deliberately corrupt user, exercise, timestamps, reps,
position, original weight/unit, a kg digit at scale 14, set identity and set
cardinality. They also insert an unexpected entry, delete an expected entry and
traverse a 251-entry dataset across the verifier's 250-entry boundary. Every
corruption must fail verification while the intact database passes. The focused
persistence suites passed **15 tests** before the error-message tests were added.

## Fresh bulk benchmark

2026-10-12 02:01:53–02:02:33 UTC, passed with no correctness or diagnostic-budget
failures. Node v24.21.0, PostgreSQL 17.11, Linux x64, Intel i5-1135G7, 8 logical
CPUs, approximately 39 GiB host RAM. One compiled API process, production mode,
silent logs, pool 10, 512 MiB heap limit; loopback traffic.

Seed: primary **51,000 entries / 153,000 sets**, secondary **1,000 / 3,000**.
Full SQL content check: **52,000 entries / 156,000 sets**.
Final: primary **90,100 / 544,000**, secondary unchanged.
Full final SQL content check: **91,100 entries / 547,000 sets**.
Primary idempotency keys: 510 at seed, 901 at completion; secondary: 10.

| Scenario | p95 ms | API CPU ms/request |
| --- | ---: | ---: |
| Fresh maximum batch, concurrency 1 | 93.9 | 29.7 |
| Fresh maximum batch, concurrency 4 | 140.1 | 27.5 |
| Replay, concurrency 4 | 48.3 | 11.4 |
| Conflict, concurrency 4 | 42.0 | 8.2 |
| Reservation rollback, concurrency 4 | 49.3 | 7.7 |
| Fresh same-key contention, concurrency 4 | 132.4 | 17.2 |

100 measured requests/scenario after 10 warmups; six mixed soak windows of 80
requests. Worst soak p95 **191.3 ms**, peak sampled API RSS **259.1 MiB**, retained
heap growth **0.0165 MiB**, slope **0.0015 MiB/window**. These are local screening
observations, not production capacity, a long endurance test, or CSV-worker data.

## Fresh history/PR benchmark

2026-10-12 02:03:47–02:04:18 UTC, all nine scenarios passed. **50,000 primary
entries / 150,000 sets**, plus **1,000 secondary entries / 3,000 sets**; seed 42,
concurrency 1, 10 warmups and 100 requests/scenario. The read fixture is inserted
directly via SQL; the independent bulk run above verifies the HTTP write path.

| Scenario | p95 ms |
| --- | ---: |
| History first page | 7.58 |
| History deep cursor (90%) | 9.30 |
| History exercise filter | 5.90 |
| History date filter | 7.25 |
| History combined filters, lb | 4.14 |
| History muscle group | 5.34 |
| Records all-time | 126.65 |
| Records monthly, lb | 31.06 |
| Records comparison | 90.72 |

Responses were checked against the existing independent read oracle; query plans
were captured. Raw local evidence: [bulk JSON](../artifacts/performance/bulk-assignment-review.json),
[read JSON](../artifacts/performance/reads-assignment-review.json),
[EXPLAIN plans](../artifacts/performance/reads-assignment-review.json.plans.json).
`artifacts/performance/` is Git-ignored; this tracked summary and runnable commands
preserve the evidence for a fresh checkout. Performance runs were sequential.

## CSV worker follow-up

[Design and acceptance cases](csv-import-design.md) specify a durable upload/job,
one separate worker, full-file validation, bounded idempotent batches, checkpoint
recovery and exact DB verification. CSV is not implemented or benchmarked here;
the assignment does not require it. File-wide atomic visibility would need a
different design from the proposed visible, resumable batches.

## Unresolved questions

- Whether to implement the optional CSV workflow; current scope is design/test cases.
- Actual video and repository publication are submission follow-up work.
