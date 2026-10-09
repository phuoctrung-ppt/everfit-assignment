# History and personal-record performance

Phase 06 measures real HTTP reads from a compiled Nest process and PostgreSQL. This diagnostic benchmark is separate from routine integration tests and the [bulk-write benchmark](bulk-performance.md).

## Reproduce

```sh
pnpm test:performance --create-isolated --entries 50000 --sets-per-entry 3 --seed 42 --output artifacts/performance/reads-local.json
```

Requires `TEST_DATABASE_ADMIN_URL` on a dedicated local/test PostgreSQL server. The runner creates, migrates, and finally drops its own random `everfit_test_<32 hex>` database. No fallback to the development `DATABASE_URL` exists. Alternatively, pass `--database-url` for a database with exactly that namespace: migrations run, populated workout tables are refused, and the caller-owned database is preserved after the benchmark. The two selection options are mutually exclusive. URLs and credentials are excluded from reports.

Dataset defaults: 50,000 primary entries/150,000 sets, plus 1,000 secondary entries/3,000 sets; seed 42; four exercises, five groups, mixed kg/lb, UTC timestamps tied in groups of four, January through May 2026. IDs, original/normalized weights, reps, dates, and expected answers are deterministic. Other-user weights and dates are deliberately distinctive so removing user scoping changes expected answers. The loader writes exact decimal strings in one transaction, verifies per-user counts, then runs `ANALYZE`. Seed writes bypass HTTP because this harness measures reads; logging is covered separately. Counts are checked again after measurements.

Each scenario makes one first-use observation, ten warmups, then 100 sequential measured requests. First-use does **not** mean a cold PostgreSQL/OS cache: loading and `ANALYZE` have already accessed the data, and earlier scenarios share caches. HTTP timing includes transfer and JSON parsing; full-response correctness assertions run after the timer. An independent BigInt/rational oracle checks all 111 responses per scenario, including record winners, ties, formulas, differences, unit rounding, complete sets, ordering, and page metadata. Cursor serialization uses the public helper; dedicated integration tests exercise invalid, foreign, and tampered cursors.

History covers first page, a cursor at the 90% boundary, exercise-only, date-only, combined name/group/date with lb output, and group-only filters. Records cover all-time kg, February lb, and January-versus-February comparison. Page size is 20. Targets were declared before measurement: warm p95 ≤250 ms history and ≤500 ms records/comparison; a miss fails the command and remains in the report. Percentiles use the nearest-rank method. Failures stop incomplete measurement and preserve a failed report; cleanup failure also fails the command.

Reports contain configuration, runtime/CPU/memory/database settings, exact query parameters, every latency sample, failures, counts, and a companion `.plans.json` path. The companion captures `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the actual repository statements and parameters after each scenario's timing. History captures both page selection and bounded set retrieval. Record plans cover winner selection; endpoint timings also include catalog lookup, conversion, and serialization. Query plans run afterward, so they can influence later scenarios' shared cache state.

## Measured results

Verified 2026-10-09, 09:37:26–09:37:57 UTC. Node v24.21.0, PostgreSQL 17.11, Linux x64, Intel i5-1135G7, 8 logical CPUs, 38.96 GiB reported host memory. API: production mode, silent logging, pool 10, 512 MiB heap limit, 5-second statement / 3-second lock timeout. PostgreSQL: 128 MiB shared buffers, 4 MiB work memory, 4 GiB effective cache size, JIT enabled globally; Docker had no configured CPU/memory cap. Shared workstation, no concurrent integration/benchmark run during these measurements. Base commit `76dad42`, phase changes uncommitted during measurement.

All nine scenarios passed: 900 measured requests plus 90 warmups and nine first-use checks, **999 correct responses, zero failures**. Counts remained exactly 50,000/150,000 primary and 1,000/3,000 secondary. API and owned database cleaned up successfully.

| Scenario                  | First-use ms | Warm p50 ms | Warm p95 ms | Target p95 ms |
| ------------------------- | -----------: | ----------: | ----------: | ------------: |
| `history-first`           |        86.92 |        4.75 |        6.58 |           250 |
| `history-deep-90-percent` |         6.39 |        3.99 |        5.49 |           250 |
| `history-exercise`        |         5.72 |        3.17 |        3.99 |           250 |
| `history-date`            |         3.70 |        3.04 |        3.90 |           250 |
| `history-combined-lb`     |         4.53 |        3.91 |        7.35 |           250 |
| `history-group`           |         4.91 |        5.63 |        7.79 |           250 |
| `records-all-time`        |       102.91 |       98.35 |      130.56 |           500 |
| `records-month-lb`        |        24.56 |       24.88 |       30.00 |           500 |
| `records-comparison`      |        49.95 |       49.76 |       68.48 |           500 |

The [Phase 06 report](../plans/20261009-1146-workout-api/reports/performance/workout-api.md) links reviewed raw samples and SQL plans. The plan directory remains locally Git-excluded; this committed summary and runner preserve reproducibility for other checkouts.

## Query findings and correction

The corrected-fixture baseline failed: all-time record p95 **637.99 ms**, with 112,500 metric-expanded rows fully ranked and an 8,864 KiB external sort. A first revision materialized matching sets once and selected a top row per metric/period, eliminating that sort, but comparison p95 still failed at **598.81 ms**. Its ranges function estimated 100 periods instead of one/two and triggered 220–341 ms of full JIT compilation. Those failed runs are retained; targets were unchanged.

The final query uses top-one selection over shared candidates and `LIMIT jsonb_array_length($3::jsonb)` on the ranges CTE. That limit equals the supplied array size; it preserves every input period while exposing its cardinality to PostgreSQL. The plan estimates one/two range rows, avoids JIT on this workload, and uses top-N heapsort without temporary blocks. Exact formulas, tie order, overlapping periods, empty results, and a single statement snapshot remain covered by integration tests. No schema, index, global JIT setting, cache, or precomputation changed.

History first/deep plans select 21 entry rows using `workout_entries_user_history_idx`; the second statement retrieves exactly 60 sets through `workout_sets_entry_id_position_key`. The deep cursor starts after 45,000 entries without OFFSET. Filtered scenarios examine at most 84 primary entry candidates for a 20-entry page on this dataset. Tiny catalog/group sequential scans are expected for four exercises/five groups.

Final record plans inspect 51,000 entry rows via a sequential scan, retain 12,500 primary Bench Press entries, and apply period filters before indexed set retrieval. The planner chose that scan; index use is not forced. All-time/month/comparison materialize 37,500 / 8,064 / 16,992 set candidates and return only 3 / 3 / 6 winner rows. Each metric scans the relevant materialized candidates and retains one top row. Corresponding SQL execution observations: 95.47 / 24.32 / 51.65 ms. Range pushdown and larger candidate materialization remain future tuning candidates if workload growth produces another measured miss; current timings do not establish larger-scale behavior.

## Limits

Loopback, closed-loop, concurrency 1 reads from one API child on a shared developer workstation. No production SLO, 10,000-coach capacity, uncached-disk, peak throughput, or sustained-concurrency claim follows. PostgreSQL and load-generator CPU/memory are not profiled here. The separately measured bulk harness provides API CPU/memory screening. Authentication, retention, runtime clean-start, and delivery remain separate concerns.
