# Bulk logging performance test

Run `pnpm test:performance:bulk` to review Phase 03's existing bulk API under a large persisted dataset. This opt-in command builds the application, creates a random isolated PostgreSQL test database, loads 51,000 entries/153,000 sets for one user through HTTP, and adds 1,000 entries/3,000 sets for another user. It requires the existing `TEST_DATABASE_ADMIN_URL`; it never targets the development `DATABASE_URL` for writes or cleanup. Generated databases are dropped afterward. Synthetic fixtures span four exercises, six months, timestamp ties, and mixed kg/lb/zero weights.

## Commands

```sh
# Standard screening: six mixed soak windows, visible HTTP logs
pnpm test:performance:bulk

# Show actual WorkoutLoggingService start/completion/failure events
PERF_LOG_LEVEL=debug pnpm test:performance:bulk

# Quiet comparison with the recorded silent baseline
PERF_LOG_LEVEL=silent PERF_ROUNDS=30 pnpm test:performance:bulk

# Explicit report location; directory created automatically
PERF_REPORT=artifacts/performance/bulk-local.json pnpm test:performance:bulk
```

`PERF_LOG_LEVEL` defaults to `info` and accepts the application log levels (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`). Backend stdout/stderr are inherited by your terminal. Use `debug` to see `WorkoutLoggingService` events; `info` shows HTTP completion/error logs. The startup banner prints the isolated backend URL and PID, so its random port is explicit. Your existing port-3000 server receives no benchmark traffic. Each scenario prints p95, CPU/request, peak sampled RSS, post-GC heap, and throughput; the JSON report records the actual log level. Logging overhead is part of the measured run, so compare runs using the same level/output destination.

Service debug events include only operation, entry/set counts, outcome, and duration. They omit user IDs, keys, bodies, and raw errors. Completion is emitted after the transaction commits; its duration includes transaction acquisition/work/commit, excludes earlier validation/fingerprinting and later HTTP serialization. Request IDs correlate service events with HTTP logs. For ordinary host development, `LOG_LEVEL=debug pnpm start:dev` enables the same service events on the application port.

`PERF_ENTRIES` defaults to 51,000, accepts multiples of 100 from 51,000 through 1,000,000. `PERF_REQUESTS` defaults to 100 measured requests per scenario, accepts 100–1,000. `PERF_ROUNDS` defaults to 6, accepts 6–120. Reports default to timestamped files under ignored `artifacts/performance/`. Avoid running other builds/load tests alongside this command. Higher settings require more time and database disk space; entries and committed replay JSON intentionally accumulate throughout a run.

## Scenarios and correctness

After dataset verification and ANALYZE, record one first maximum-batch observation separately. The database is already warm from loading; this is not a cold-cache benchmark. Each measured scenario follows ten warmup requests:

| Scenario | Payload and behavior |
| --- | --- |
| `fresh-c1` | New keys; 100 entries × 10 sets, concurrency 1 |
| `fresh-c4` | Same maximum payload, distinct new keys, concurrency 4 |
| `replay-c4` | Concurrent replay of an already committed maximum response |
| `conflict-c4` | Different body reusing that key; expected 409 |
| `reservation-rollback-c4` | Unknown final exercise; expected 400; rolls back reservation before workout insertion |
| `fresh-same-key-c4` | Groups of four requests share a new key and must return the same committed response |

The mixed soak alternates maximum fresh writes, committed replay, conflicts, and reservation rollback at concurrency 4: 80 requests/window, following 80 mixed warmup requests. Post-GC baseline follows these warmups. A corrected request finally retries a previously rejected key. Existing integration suites separately verify rollback after actual entry/set writes, replay-storage failure, and deferred COMMIT failure.

Every successful response is checked for shape, user, exercise, timestamps, set order/reps, exact original weight, and converted display weight. Replay responses must match; concurrent fresh-key responses have identical validated-content digests. Database entry/set/key counts are verified after each scenario and soak window for both users. No committed incomplete idempotency record is permitted. Failures return a nonzero exit code and retain available measurements in the JSON report.

## Measurements and interpretation

The compiled Nest application runs in a child process with production mode, the selected log level, a ten-connection pool, normal 5s statement/3s lock timeouts, and a 512 MiB V8 old-space limit. A separate TypeScript parent generates HTTP requests and validates results. CPU/memory measurements belong to the API process; they exclude the parent, PostgreSQL, and the rest of the host. Metrics and GC controls use private IPC, never a public API endpoint.

- Raw request durations and p50/p95 use nearest-rank percentiles. Timing includes parent request serialization, loopback scheduling, and complete response download; response validation occurs afterward.
- API CPU user/system milliseconds and CPU milliseconds/request come from `process.cpuUsage`. One-core CPU percentage is CPU time / wall time; it can exceed 100% when several process threads run.
- Throughput and average CPU percentage describe a closed-loop workload. Parent validation/scheduling gaps affect them; they are not maximum server capacity measurements.
- RSS, heap, external memory, and ArrayBuffers are sampled every 20 ms; sampled peaks can miss brief allocations or pauses. `maxRssKiB` is the process lifetime high-water mark, including loading. RSS includes allocator/native memory and need not fall immediately after garbage collection.
- Event-loop p95 delay and utilization are reported for each window.
- Two explicit GC cycles at idle checkpoints provide retained-heap samples. GC runs outside timed CPU/latency windows. Report final-minus-baseline growth and least-squares MiB/window slope, with raw samples. RSS/external/ArrayBuffer values are observed alongside heap; a passing finite soak is evidence against substantial retained growth in these workloads, not proof of leak freedom.
- Pool total/idle/waiting counts and active resource types are captured at idle checkpoints. Every measured window requires zero waiting clients and all checked-out clients returned.
- Table sizes include indexes and TOAST. Idempotency response storage has no expiry by contract, so database storage growth is expected and distinct from an application memory leak.

## Fixed diagnostic budgets

These local guardrails were chosen before the first run. They are not assignment mandates or production SLOs. A breach stays visible and fails the command; budgets must not be silently loosened to manufacture a pass.

| Metric | Budget |
| --- | --- |
| Warm p95 response duration, each scenario/window | ≤1,000 ms |
| API CPU/request | ≤100 ms |
| Sampled RSS | ≤512 MiB |
| Post-warmup final retained-heap growth | ≤16 MiB |
| Retained-heap regression slope | ≤1 MiB/window |
| Unexpected responses, row-count errors, unreleased pool clients | 0 |

Repeated validation and response parsing are profiling candidates: requests are validated at the controller/service boundaries, and responses before persistence/serialization. Conflicting keys currently read and validate stored response JSON before fingerprint comparison. The benchmark includes these costs. Avoid weakening validation or changing replay behavior without measured benefit and regression coverage.

## Measured local run — 2026-10-09

Extended run used 30 windows with the then-default silent logging. Reproduce that logging mode with `PERF_LOG_LEVEL=silent PERF_ROUNDS=30 pnpm test:performance:bulk`. All diagnostic budgets and correctness checks passed. Environment: Node v24.21.0, PostgreSQL 17.11, Linux x64, Intel i5-1135G7, 8 logical CPUs, 39.0 GiB reported host RAM. Base application commit `6e6b680`; harness was an uncommitted working-tree addition. Production mode, silent logging, loopback HTTP. Total execution approximately 69 seconds; this is a short soak, not hours of endurance testing.

Seed: primary user 51,000 entries/153,000 sets; secondary user 1,000/3,000. End: primary user 138,100 entries/1,024,000 sets and 1,381 idempotency records; secondary unchanged. Each scenario below has 100 measured requests after ten warmups; mixed soak has 30 × 80 requests.

| Scenario | p50 ms | p95 ms | API CPU ms/request | requests/s |
| --- | ---: | ---: | ---: | ---: |
| `fresh-c1` | 62.0 | 91.9 | 29.9 | 14.4 |
| `fresh-c4` | 136.5 | 321.7 | 39.6 | 24.7 |
| `replay-c4` | 45.0 | 64.4 | 15.3 | 79.1 |
| `conflict-c4` | 24.5 | 34.7 | 7.8 | 150.6 |
| `reservation-rollback-c4` | 22.8 | 29.4 | 6.6 | 167.6 |
| `fresh-same-key-c4` | 91.1 | 114.4 | 17.9 | 41.2 |

Retained heap after GC: **24.14 → 24.26 MiB**, growth **0.12 MiB**, least-squares slope **0.0045 MiB/window**. Sampled peak RSS: **261.6 MiB**. Post-GC external memory stayed **2.82 MiB**. Every idle pool checkpoint had all clients returned and zero waiting. No substantial retained growth exceeded the screening budgets; this does not prove absence of smaller or longer-lived leaks.

Idempotency table/index/TOAST storage grew **10.5 → 56.6 MiB** while successful writes accumulated. This is expected persistent replay storage. Source review found request-bounded allocation and indexed lookup, with no user-history load. Repeated validation and conflict replay parsing remain optimization candidates; measured budgets did not justify changing those safety boundaries.

Raw evidence: local [extended JSON report](../plans/20261009-1409-bulk-performance/reports/bulk-extended.json). The plan directory remains excluded from Git; this committed summary preserves the reviewed values.

## Sources

Measurement semantics follow [Node process CPU/memory documentation](https://nodejs.org/docs/latest-v24.x/api/process.html) and [Node performance hooks](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html). These APIs report process resources; they do not identify an individual allocation leak or measure database CPU.

Measured execution evidence is recorded with the local [bulk performance plan](../plans/20261009-1409-bulk-performance/plan.md). History and personal-record query benchmarks remain future Phase 06 work; these results cannot establish performance for 10,000 concurrent coaches.
