# Delivery verification

Phase 07 prepares reproducible local delivery. This document separates observed results from work awaiting verification. No deployment, repository publication, or completed video is implied.

## Previously recorded baseline

The tracked Phase 06 change is commit `efc6fc044a3c5ccd5e9e5c99d333df4dbf0a20b3`. Its historical session record reports lint/build/TypeScript, 244 unit tests, and 239 PostgreSQL integration tests passing. These are earlier observations, not Phase 07 rerun results.

- [Read performance](read-performance.md): 50,000 primary entries/150,000 sets plus another user's data; 999 checked responses; history p95 3.90–7.79 ms, all-time records 130.56 ms, comparison 68.48 ms. Concurrency 1 on the recorded local host.
- [Bulk performance](bulk-performance.md): separate API CPU/memory and finite-soak measurements, with methodology and limits.
- [AI workflow](../AI_WORKFLOW.md): actual corrections and rejected retry option, linked to tracked source/tests. Earlier raw reports under `plans/` are Git-excluded; the committed summaries preserve reported results and reproduction commands, not raw historical output.

## Phase 07 observations

Documentation evidence check at 2026-10-09 09:49 UTC:

```sh
pnpm test:unit --runInBand src/config/configuration.spec.ts test/performance/read-oracle.spec.ts
```

Result: **2 suites, 23 tests passed**, exit 0. This verifies current configuration-error regressions and independent benchmark fixture/oracle behavior. It does not replay historical failures.

Initial runtime verification used dedicated Compose project `everfit-clean-check-20261009-07`, API port `3307`, PostgreSQL port `55437`, production mode, and info logging. The private environment file stayed in the locally ignored delivery-report directory. `docker compose --env-file <private-env-file> -p everfit-clean-check-20261009-07 up --build -d` completed; initialization applied three migrations and seeded four exercises before API readiness. `/health` returned 200, `/exercises` returned the four seeded exercises, and the API process ran as `node` (UID 1000).

Fresh final checks below ran on 2026-10-09. Private environment, raw logs, synthetic replay fixtures, and command output remain in the locally ignored Phase 07 delivery report; no credentials or generated workout data are committed.

| Delivery check                                                                                         | Phase 07 result                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty dedicated Compose volume; migrations and catalog seed before API                                 | Passed: 3 migrations, 4 catalog exercises                                                                                                                                                                                                                        |
| Production non-root process and healthy API                                                            | Passed: UID 1000; readiness 200                                                                                                                                                                                                                                  |
| Repeat initialization preserves catalog/workouts                                                       | Passed: zero new migrations; seed repeated; saved history and replay unchanged                                                                                                                                                                                   |
| Public smoke: catalog, writes/replay/conflict, rollback, filters, PRs/comparison, errors, empty ranges | Passed: 35 HTTP assertions; four isolated entries per run                                                                                                                                                                                                        |
| API restart preserves workout IDs and replay body                                                      | Passed: 3-request saved-state verification after API restart and initializer rerun                                                                                                                                                                               |
| Database interruption: sanitized 503, recovery                                                         | Passed: readiness/catalog/history/records returned sanitized 503; readiness recovered to 200                                                                                                                                                                     |
| Missing/invalid configuration fails without leaking values                                             | Passed: container without DATABASE_URL exited 1 with field-only fatal error; invalid-value unit regressions passed                                                                                                                                               |
| JSON request logs include request ID/status/duration; exclude sensitive fields                         | Passed: 115 JSON HTTP logs; body/query/header/key sentinels absent                                                                                                                                                                                               |
| Graceful shutdown closes pool; owned test resources cleaned up                                         | Shutdown passed: 0.291 s, exit 143 (SIGTERM), no OOM, zero remaining database sessions; dedicated containers/network/volume removed, normal development PostgreSQL retained                                                                                      |
| Lint, build, full TypeScript check                                                                     | Passed: pnpm lint, pnpm build, pnpm exec tsc --noEmit; seed compilation and frozen install also passed                                                                                                                                                           |
| Complete unit and PostgreSQL integration suites                                                        | Passed: 244 unit tests / 17 suites; 239 integration tests / 28 suites on the isolated PostgreSQL server                                                                                                                                                          |
| README commands, Markdown links, final review                                                          | Passed: 8 README curl requests (isolated port and real cursor); host migrate/seed/compiled/watch startup; independent review found no Critical/Important issues. Three minor findings corrected; 54 local Markdown links resolved; video demo commands exercised |

No new benchmark result is claimed by Phase 07. Rerun performance if runtime/query changes materially affect the previously measured path; otherwise retain the qualified historical measurements.

## Reproduce isolated startup

Choose unused ports and a new project name so the volume starts empty. Create `.env.delivery` from `.env.example`; do not overwrite an existing environment file. This file is Git-ignored by `.env.*`. Set `PORT=3307`, `POSTGRES_PORT=55437`, `NODE_ENV=production`, and `LOG_LEVEL=info`; replace the password and use port `55437` in both host database URLs. Keep credentials out of screenshots and shell output. The Compose database URL uses its internal host/port automatically.

```sh
cp -n .env.example .env.delivery
# Edit .env.delivery with the isolated settings above before starting.
export DELIVERY_PROJECT="everfit-delivery-$(date +%s)"
docker compose --env-file .env.delivery -p "$DELIVERY_PROJECT" up --build -d
docker compose --env-file .env.delivery -p "$DELIVERY_PROJECT" ps -a
curl --fail http://localhost:3307/health
export DELIVERY_STATE="/tmp/$DELIVERY_PROJECT-smoke.json"
pnpm smoke --base-url http://localhost:3307 --state-file "$DELIVERY_STATE"
docker compose --env-file .env.delivery -p "$DELIVERY_PROJECT" run --rm migrate
docker compose --env-file .env.delivery -p "$DELIVERY_PROJECT" restart api
curl --fail --retry 20 --retry-connrefused --retry-delay 1 http://localhost:3307/health
pnpm smoke --base-url http://localhost:3307 --verify-state "$DELIVERY_STATE"
```

Wait for readiness before the smoke run and after restart. The state file stores synthetic request/replay/history data with mode 0600 and refuses to overwrite an existing file. `--verify-state` replays that exact request and compares the saved response and complete history; a fresh smoke run alone cannot prove earlier IDs survived. Remove your own state file after the check. Repeating the initializer should report no pending migrations and preserve existing workouts. The script uses synthetic uniquely scoped users; each invocation adds its own smoke records.

When finished with this newly created disposable project, remove only its resources using the same saved `DELIVERY_PROJECT` value:

```sh
docker compose --env-file .env.delivery -p "$DELIVERY_PROJECT" down --volumes --remove-orphans
```

This cleanup deletes that project's test database volume. Do not substitute the normal development project name. The observation table records the outage/log/shutdown checks from this session. These container lifecycle checks are separate from the HTTP-only smoke script.

## Submission handoff

- [English video outline](video-walkthrough-outline.md): 19-minute script with API demo, AI corrections, code explanation, and 10,000-coach discussion. Actual recording **pending**.
- Local Git history contains incremental implementation commits. `git remote -v` returned no configured remote during the documentation check; an accessible repository URL and publication remain **unconfirmed**. A local commit is not a published submission.
- No claim of 10,000-coach capacity: authentication, authorization, load characterization, sustained concurrency tests, operational policy, and infrastructure decisions remain production work.

Unresolved handoff: actual English recording and accessible repository delivery location.
