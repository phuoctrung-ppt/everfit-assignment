# AI Workflow

## 1. Coding Agent Setup

My first step was to set up Codex with skills relevant to the Everfit Workout Logging API assignment. I selected guidance for backend development, database design, code review, DevOps, problem-solving, security, and request validation. This gives the agent reusable instructions that I can apply to each task without repeating the same conventions in every prompt.

In addition to the skills, I have added an `AGENTS.md` file as the primary entry point for project instructions; Codex automatically loads this file when starting a project session. This file directs the agent to adhere to the coding standards in the `docs/` directory, as well as the development and documentation guidelines in the `workflow/` directory. I also added a `plans/` directory to house implementation plans. Collectively, these files provide project context, working rules, and a centralized location for documenting planning-related decisions.

### Project structure

```text
everfit-assignment/
├── .agents/
│   └── skills/
│       ├── code-review/SKILL.md
│       ├── databases/SKILL.md
│       ├── devops/SKILL.md
│       ├── nestjs-skills/
│       │   ├── SKILL.md
│       │   ├── agents/openai.yaml
│       │   ├── references/
│       │   └── scripts/context-builder.mjs
│       ├── problem-solving/SKILL.md
│       ├── security/SKILL.md
│       └── zod-validation/SKILL.md
├── docs/
│   └── code-standards.md
├── plans/                            # Estimate and phased implementation plan
├── workflow/
│   ├── development-rules.md
│   └── documentation-management.md
├── AGENTS.md
└── AI_WORKFLOW.md
```

This is a shortened view of the agent-related files. Codex discovers project skills in `.agents/skills/`. Each skill has a `SKILL.md` containing its name, description, and instructions; supporting scripts and references are optional. Codex can select a skill based on the task, or I can explicitly request one with a mention such as `$nestjs-skills`. See the [official skills documentation](https://learn.chatgpt.com/docs/build-skills).

### How the setup files fit together

| File or directory | Responsibility in the setup |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Entry point for project instructions. Defines the agent's responsibilities and points to the development rules, documentation rules, and coding standards. |
| [workflow/development-rules.md](workflow/development-rules.md) | Defines implementation and review expectations, simplicity principles, and checks before commits and pushes. |
| [workflow/documentation-management.md](workflow/documentation-management.md) | Defines when documentation should be updated and how plans, phase files, research, and reports should be organized. |
| [docs/code-standards.md](docs/code-standards.md) | Defines Everfit-specific conventions for application structure, validation, workout calculations, persistence, testing, and review, aligned with the Codex setup and development rules. |
| `.agents/skills/` | Provides task-specific guidance, such as NestJS development, database design, validation, and code review. |
| `super-powers` plugin | Supports brainstorming and planning with human input. Its planning output belongs in the project's `plans/` structure, following the documentation rules. The plugin is installed separately from the project skills shown above. |
| `plans/` | Stores estimates and implementation roadmaps. The [workout API plan](plans/20261009-1146-workout-api/plan.md) preserves my 22.5-hour estimate and links seven implementation phases. No interactive dashboard is present in the current workspace. |
| [AI_WORKFLOW.md](AI_WORKFLOW.md) | Explains my AI setup and choices for the assignment. |

The intended reading order is `AGENTS.md`, the referenced rules and standards, then the relevant skills and task plan. These files describe the setup; detailed development steps belong in the plans themselves.

The documentation rules define this layout for future plans:

```text
plans/
└── YYYYMMDD-HHmm-plan-name/
    ├── plan.md                 # Overview, phase status, and dependencies
    ├── phase-01-name.md         # Detailed work and success criteria
    ├── research/               # Supporting research, when needed
    └── reports/                # Findings and review reports, when needed
```

The tree above is the general naming template. Current written artifacts are the [design specification](docs/workout-api-design.md) and [phased plan](plans/20261009-1146-workout-api/plan.md). The assignment PDF supplies the requirements; the new project `README.md` documents the implemented foundation.

### Why I selected these skills and plugins

| Skill or plugin | Intended use in this assignment |
| --- | --- |
| `nestjs-skills` | Guide backend structure, modules, dependency injection, controllers, services, error handling, and NestJS testing. Its context builder selects guidance relevant to the current task. |
| `databases` | Support the selected PostgreSQL database. The design justifies it through relational constraints, atomic logging, and PR queries. |
| `code-review` | Review generated changes against requirements, question unnecessary complexity, and require verification before claiming work is complete. |
| `devops` | Guide Docker setup and environment configuration for a reproducible local runtime. |
| `problem-solving` | Help reason through unit normalization, personal-record calculations, bulk operations, concurrent writes, and performance with 50,000+ entries per user. |
| `security` | Guide input handling, secrets management, and security review within the assignment's scope. Authentication is explicitly not required. |
| `zod-validation` | Guide request schemas and inferred TypeScript types for dates, units, sets, reps, and weights, if Zod is adopted. |
| `super-powers` | A plugin available through the plugin marketplace for task brainstorming and planning. I chose it for its emphasis on human-in-the-loop collaboration, helping me clarify requirements, discuss trade-offs, and refine plans before implementation. |

Backend guidance is covered by `nestjs-skills` and `databases`; the current project has no separate `backend` skill. I will use relevant skills as needed and adapt their general guidance to the assignment's requirements.

### Codex configuration

My personal settings are stored in `~/.codex/config.toml`. The relevant excerpt is shown below, with the project path replaced by a portable placeholder:

```toml
model = "gpt-6-astra"
model_reasoning_effort = "high"

[projects."/absolute/path/to/everfit-assignment"]
trust_level = "trusted"
```

The model setting selects my default coding model, and `high` sets the requested reasoning effort. The project is marked as trusted. Codex supports project overrides in `.codex/config.toml`, but this workspace currently uses my personal configuration and has no project configuration file. Configuration defaults can also be overridden by the active session. See the [official configuration documentation](https://learn.chatgpt.com/docs/config-file/config-basic).

The personal configuration selects Codex defaults, `AGENTS.md` connects the project rules and documentation, and `.agents/skills/` supplies specialized task guidance.


## 2. Requirements and design session — 2026-10-09

### What actually happened

I asked Codex to use Superpowers skills to brainstorm requirements from `Backend Engineer.pdf`. Codex read the PDF and repository rules, summarized the features and delivery obligations, and asked focused questions before writing application code.

I selected **NestJS, PostgreSQL, and Docker Compose** and supplied the **22.5-hour A–K estimate**, including review/correction of AI output and focused tests within each package. Codex preserved it in the [plan](plans/20261009-1146-workout-api/plan.md). Preparation and recording of the required 15–20-minute English video are additional; I have not allocated that time yet.

| Decision | My input | Resulting design |
| --- | --- | --- |
| Bulk behavior | “atomic request” | All entries succeed together or roll back |
| Duplicate retries | “should use idempotency-key for avoid duplicate if trying request” | Required key, matching response replay, 409 for changed payload |
| Dates | “utc time” | UTC timestamps; inclusive-start/exclusive-end ranges |
| Exercise identity | Accepted catalog recommendation | Stable exercise IDs; unknown logging names rejected |
| PR periods | Accepted arbitrary-range recommendation | Compare two explicit UTC periods |
| Storage | “relation table” | Relational entries/sets; SQL PR selection |
| Review | Approved schema, API contract, then final design section | Consolidated written design and implementation plan |
| Documentation | Asked to fill this file based on our work with AI | Actual evidence, without invented coding/testing claims |

Codex proposed the schema, API contracts, calculation rules, transaction flow, and verification strategy. I reviewed them in stages. The written draft adds concrete defaults for tooling, precision/serialization, limits, timeouts, and benchmark targets; these still require document review before implementation.

### Tools and observed use

| Tool or guidance | Actual use in this session |
| --- | --- |
| Codex | Assignment analysis, design discussion, estimate organization, documentation drafts |
| Superpowers using-superpowers / brainstorming | Context gathering, alternatives, focused questions, staged design review |
| Superpowers writing-plans | Files, interfaces, verification steps, and dependencies for seven planned phases |
| Local NestJS, PostgreSQL, Zod guidance | Proposed module boundaries, transactions, schema placement; no packages installed |
| Read-only subagents | Audit PDF ambiguities and check whether AI-evidence claims match the conversation |
| Official PostgreSQL / node-postgres documentation | Verify NUMERIC, uniqueness/indexing, single-client transaction guidance; sources linked in design |
| Local file/Git tools | Inspect workspace and verify documentation; not application test evidence |
| Other AI coding tools | None evidenced yet; available for later work if needed |

### Prompting strategy

I supplied the assignment PDF and repository context rather than only asking for a workout API. `AGENTS.md` connects development, documentation, and coding rules. I then supplied the stack/estimate and answered one design question at a time. This clarified atomicity, retries, timezones, exercise identity, period comparisons, and storage before implementation.

The plan breaks implementation into packages with focused tests and reviewer checks. AI-assisted scaffolding, boilerplate, coding, debugging, and testing are intended future uses; they have not occurred in this planning session. I will review generated changes and retain actual correction evidence as implementation proceeds.

## 3. Rejected option and correction evidence

### Rejected design option: accept retries as independent submissions

Codex offered accepting submissions independently versus supporting an idempotency key. I chose `Idempotency-Key` because retrying a request must not duplicate workout entries. The revised design uses a user-scoped key, payload fingerprint, original-response replay, 409 for changed payloads, and one transaction for the key and workout rows.

This does not reject legitimate entries sharing a user, exercise, and timestamp: distinct keys may still create separate logs. The rejected option was leaving retries unprotected, not allowing legitimate repeated workouts.

Evidence: my reply beginning “yes, should use idempotency-key…” and the [logging design](docs/workout-api-design.md). This is a design decision, not an implemented or tested bug fix.

### Corrected AI output 1: replay verification was too strict

Codex's first phase-03 draft required retries to return “byte-equivalent JSON bodies/status” while the design stores response bodies in PostgreSQL JSONB. A read-only review agent identified that JSONB can change object-key order, so byte equality was not guaranteed by the proposed storage design. PostgreSQL documents this behavior in its [JSON documentation](https://www.postgresql.org/docs/current/datatype-json.html).

Codex corrected the plan to require deeply equal JSON content and the same HTTP status, and clarified the design contract. This retains the user's duplicate-prevention requirement without imposing an unsupported serialization guarantee. Evidence: the reviewer finding in this session, the corrected [phase-03 verification step](plans/20261009-1146-workout-api/phase-03-atomic-logging.md), and the design's idempotency section.

Verification here is a document review and text-consistency check. No replay endpoint or application test has been implemented or run. This was an AI-assisted review correction within my requested workflow; I have not yet reviewed the corrected written draft myself.

### Corrected AI output 2: checked-out PostgreSQL clients could crash the process

During Phase 01, Codex generated a transaction helper that handled rejected queries and listened for errors on the pool. The independent reviewer reproduced a process crash when a checked-out client lost its backend connection: pool listeners cover idle clients, while a checked-out client emits its own error event. A new real-PostgreSQL integration test also reproduced the unhandled error.

Codex added a scoped client error listener, marks failed clients for destruction, and keeps the listener on discarded sockets to handle late errors. Healthy clients release their temporary listener. The regression terminates its own transaction backend and verifies that a subsequent query can obtain a working connection. Evidence: `src/database/database.service.ts`, `test/foundation.integration-spec.ts`, and the reviewer report in this execution session. This was an AI-assisted implementation/review correction; it does not claim a separate human code review.

### Additional implementation corrections

- The generated URL refinement called `new URL()` even after Zod's URL check failed. Two unit cases demonstrated an uncaught `Invalid URL` instead of sanitized field-name errors. Guarding with `URL.canParse()` restored the configuration error contract.
- The initial bootstrap called `app.get(PinoLogger)`, which Nest rejected because the provider is scoped. Registering the exception filter through `APP_FILTER` lets dependency injection manage the logger; HTTP integration tests then passed.
- The reviewer sent unsupported charset/encoding and corrupt compressed JSON. The initial exception filter reported server errors. A parser-specific middleware now translates trusted parser statuses to sanitized 400/413/415 envelopes; the added integration regression verifies those cases.
- node-pg-migrate 9 uses ESM exports. Its initial direct import failed in the CommonJS Jest/TypeScript setup. The shipped migration script now uses native dynamic import; tests invoke that same script in a subprocess, including migration count/no-op and rollback/reapply checks.

### Documentation discrepancy corrected during this update

The earlier draft linked `plans/20261009-0955-assignment-estimate/plan.md` and described an interactive dashboard. Inspection found the referenced file absent and `plans/` empty before this task. This update replaces that link with the actual plan and removes the dashboard claim. Earlier authorship was not established in this session, so this is not counted as a proven AI-output mistake.

## 4. Phase 01 implementation session — 2026-10-09

The user instructed Codex to execute Phase 01 and use the NestJS context builder plus relevant DevOps, database, security, and Zod skills. Codex read the repository rules, PDF, design, and phase plan; ran the context builder; and applied task-matched references. Generic ORM/class-validator/auth examples were not adopted because the project specifies direct pg, Zod, and no authentication.

Execution used a bounded database implementation subagent and an independent reviewer, with the main agent implementing configuration, application/HTTP plumbing, Docker setup, documentation, and verification. The plan-referenced Superpowers execution skills were unavailable in this session, so native execution followed the repository's review/verification gates. No new planning approval was requested after the explicit execution instruction.

Published dependency metadata revealed that nestjs-zod 5.5.0 supports Nest 10/11, not Nest 12. Codex pinned Nest 11.2.7 with Node 24.21.0 and compatible tooling. PostgreSQL 17.11 is the tested database image. Official sources and exact dependencies are in README/package.json/lockfile.

Verification records distinguish initial failures from successful checks: dependency/config setup errors occurred first; configuration and integration tests then exposed the concrete defects above. Migration tests were added alongside implementation; a preimplementation red cycle for every requirement was not demonstrated.

Current evidence:

- Foundation application, six-table migration, isolated test database harness, Docker/Compose, README, and dependency lockfile implemented.
- Lint, build, full TypeScript check, unit/integration tests and production dependency audit run; final results recorded in the Phase 01 report.
- Fresh isolated Compose volume: startup/migration ordering, healthy endpoint, migration rerun, database outage/recovery, API restart, JSON logs, and sensitive-input exclusion verified. Test infrastructure is separate from existing containers/volumes.
- Independent review identified the two HTTP/parser and database-connection defects above; fixes and regression checks are included.
- Business endpoints, unit conversion, concurrency/idempotency behavior, 50,000-entry benchmarks, final delivery hardening, and English walkthrough video remain future work. No deployment or publishing performed.
- Existing `/plans/` Git exclusion retained. Local plan/report updates record progress; application documentation and implementation changes are committed separately from the preexisting assignment PDF.

Outstanding questions: video preparation/recording time remains unallocated; no Phase 01 implementation decision is outstanding.


## 5. Phase 02 implementation session — 2026-10-09

User requested Phase 02 execution using NestJS/database skills and development-only Swagger. Codex loaded the NestJS context builder and database indexing, Zod, and code-review guidance. Two bounded implementation agents handled units/contracts and catalog/seeding; the primary agent handled Swagger, dependency compatibility, integration, and documentation. An independent reviewer checked the combined implementation.

Changes: decimal.js 10.6.0 with isolated 50-digit arithmetic; strict shared workout contracts; stable JSON catalog and atomic repeatable seed; catalog discovery/transaction-client lookup; Swagger 11.4.7 with Zod response schemas, enabled only in development. Published peer metadata excluded Swagger 12 because this project uses Nest 11. The optional Scarf install script is explicitly disabled, consistent with the existing build-script policy.

Verification: conversion/schema tests first failed for absent implementation, then passed. Aggregate unit suite: 102 tests; PostgreSQL/HTTP integration: 41 tests. Lint, build, full TypeScript checking, and repeated host `pnpm db:seed` passed. Existing database-service formatting required a cosmetic correction for the lint gate. The Swagger environment test initially reused the ConfigModule import across simulated process modes; resetting the module registry before each bootstrap made each mode match a fresh process. Production and test docs/assets return 404; development serves UI/JSON.

Index checks used 10,000 disposable catalog rows, 100 muscle groups, and 10,000 mappings with default planner settings and ANALYZE. EXPLAIN ANALYZE confirmed existing normalized-name and reverse mapping indexes for selective predicates. No new index or 50,000-workout-entry performance claim. Seed failures roll back, repeated seeds keep counts stable, and catalog renaming preserves historical exercise IDs.

Host development exposes Swagger at `/docs`; Compose remains production, and the TypeScript seed CLI runs on the host with development dependencies. Phases 03–07 remain pending. No deployment or publishing performed.

Independent Phase 02 review reproduced a Unicode normalization mismatch: JavaScript lowercased `İ Press` differently from PostgreSQL’s CHECK expression, so valid seed input failed. Migration 002 makes application normalization authoritative, backfills existing names, preserves unique indexing, and allows lowercase expansion beyond 200 characters in the normalized column. A real-database regression covers Turkish dotted I, Greek final sigma, an apostrophe during backfill, and a maximum-length expanding name.

Reviewer rechecked the Unicode fix and found no remaining blockers. An independent collision probe confirmed that migration failure rolls back without merging catalog IDs or advancing the migration version.


## Phase 02 review follow-up

User requested fixes from the second review and explicit controller/service/repository separation. NestJS context builder guidance was applied using existing pg and Zod dependencies. Bounded agents fixed UUID/NUL validation and verified complete repository SQL; the primary agent introduced ExercisesService, transient error classification, response serialization, and HTTP regressions.

Catalog controllers now depend only on the service, and the module exports the service rather than persistence. Response mapping and name normalization sit in the service. `ZodResponse` and the DI-managed serializer connect runtime output validation with Swagger. The separation and validation fixes introduced no additional dependencies or indexes; the subsequent pagination work adds migration `003-exercise-cursor-index.cjs`.

The first new unreachable-database HTTP test found that native driver errors can originate from another JavaScript realm; `instanceof Error` missed them. Structural code inspection fixed classification, with an explicit cross-realm unit regression.

The review also identified missing database-level cursor pagination. That catalog work is now implemented: query DTOs validate optional cursor and bounded limit, the repository uses a parameterized keyset query with name/UUID ordering and `limit + 1`, and the service assembles `nextCursor` from the last returned exercise. The cursor index matches the query collation and ordering. SQL limits exercise rows before joining their complete muscle-group mappings.

Pagination is opt-in per route. List endpoints that need it use `CursorPaginationQuerySchema` (default limit 20, maximum 100) and return `CursorPage<T>`. Routes needing only pagination can accept `CursorPaginationQueryDto`; the exercises route uses `ExerciseListQueryDto`, extending the shared schema with optional `muscleGroup`. The filter uses trimmed, case-insensitive exact matching and is applied before pagination. Cursor validation binds subsequent pages to the normalized filter. Routes such as `/health` do not use these contracts; no global pagination interceptor, exclusion metadata, or parameter-hiding mechanism is required.

Shared cursor encoding/decoding and page schemas live in `src/schemas/pagination.schema.ts`; next-cursor assembly remains in the service, and keyset SQL remains in the repository. Swagger and `ZodResponse` reflect each route's query and response contracts. Tests and live OpenAPI checks confirm `/exercises` exposes optional `muscleGroup`, `limit`, and `cursor`, while `/health` exposes none. Live filtered traversal returned Bench Press then Push Up; changing the filter with the same cursor returned 400.

Final pre-commit review found that JSON escaping of valid catalog names and a muscle-group filter could exceed the original cursor bound. The bound is now 4,096 characters, with a real HTTP traversal regression for maximally escaped names.

Final follow-up verification: 159 unit tests, 97 PostgreSQL/HTTP integration tests, Nest build, full TypeScript check, and full lint passed. Independent reviews found no blocking findings. The earlier logger-formatting lint failure no longer applies; its local formatting was corrected. Local execution evidence is recorded in the Phase 02 plan and the pagination/filter plans under `plans/`, which retain the existing Git exclusion. Catalog pagination is complete; planned workout-history pagination and later assignment phases remain open.

Unrelated local logger and Compose-mode edits, and the preexisting assignment PDF, are excluded from this follow-up commit. The logger edit remains functionally unresolved: an earlier standalone probe reproduced `TypeError: err.message is not a function` when serializing an error. Passing the catalog suites does not verify that local logger behavior.


## 6. Phase 03 atomic logging session — 2026-10-09

User requested execution of “phase-03-atomic-login”; the repository phase is atomic workout logging. Codex followed that plan and kept authentication outside assignment scope. Applied security throughout, NestJS context-builder guidance for modules/transactions/validation/logging, PostgreSQL database guidance, Zod contracts, and code-review verification gates. No unresolved implementation issue required the problem-solving skill.

The main agent implemented both POST routes, required duplicate-safe idempotency headers, versioned stable SHA-256 fingerprints, batched parameterized inserts, response mapping, and persistent reservation/replay. One bounded agent wrote real PostgreSQL tests; an independent reviewer checked source and final tests. Reservation, writes, validated response storage, and commit use one client with explicit READ COMMITTED isolation. Replay precedes catalog lookup and survives restart/renaming. No dependencies or migrations added.

Initial fingerprint tests failed for the missing helper; four PostgreSQL route tests failed with 404 before route registration. Integration bootstrap then exposed a missing DatabaseModule import in WorkoutsModule, which was fixed. An unreachable-database test initially reused cached Nest configuration; moving it to its own Jest suite provided an independent bootstrap. The existing local logger edit invoked err.message as a tagged-template function; it was replaced with a generic error serializer. A real Pino regression verifies serialization neither throws nor leaks request secrets/raw errors. Existing Compose mode changes and the assignment PDF were preserved outside this implementation commit.

Independent review found a test-evidence flaw: count assertions inside injected repository failures could be swallowed as expected HTTP 500 errors. Counts are now captured inside the transaction and asserted outside Nest’s exception boundary. The corrected four-test failure suite passed. No source/security blockers remained.

Verification: lint, Nest build, full TypeScript checking, 168 unit tests and 121 PostgreSQL/HTTP integration tests passed. Phase 03 contributes 24 integration cases, covering two-app concurrent replay, distinct-key writes, scoped conflicts, rollback after partial writes/response storage/deferred COMMIT failure, injected lost commit acknowledgement, real lock/statement timeouts, unavailable connection acquisition, validation boundaries, and maximum 100-entry/1,000-set requests. Swagger documents both routes and required headers. The lost acknowledgement case injects a driver-shaped error after a real commit; it does not simulate a physical network outage.

Phase 03 is complete; history, personal records, broader performance verification, and final delivery remain planned. No deployment, push, or publishing performed. Local plan/report artifacts retain the existing Git exclusion.

Unresolved questions: none for Phase 03.


## 7. Phase 03 bulk performance review — 2026-10-09

User invoked code-review and requested bulk CPU/memory testing with more than 50,000 entries per user. Applied code-review, security, NestJS context-builder, and database skills. An independent reviewer inspected the existing write path and the new harness; source inspection found request-bounded allocations and no history-sized reads. Repeated validation and conflict replay parsing are CPU candidates, but measured budgets did not justify application changes.

Added opt-in `pnpm test:performance`: isolated PostgreSQL database, synthetic mixed-unit HTTP loading, compiled Nest child with private IPC instrumentation, latency/CPU/event-loop/memory/pool diagnostics, fixed predeclared budgets, raw JSON reports, and a configurable soak. Parent generation/validation is outside measured API CPU/memory; closed-loop timing limitations are documented. No dependency, migration, or production source change.

Initial six-window run passed. Review then separated committed replay from fresh-key contention, renamed unknown-exercise failures as reservation rollback, and documented that they do not exercise rollback after writing workout sets. Added fresh-key groups with response-digest equality and exact single-commit counts. Parent final review tightened cleanup so forced worker termination fails the benchmark. A final six-window run passed with clean shutdown; longer 30-window evidence is also preserved.

Extended run: seed 51,000 primary entries/153,000 sets plus 1,000 secondary entries; end 138,100 primary entries/1,024,000 sets. Maximum 100-entry/1,000-set batch p95: 91.9ms at concurrency 1, 321.7ms at concurrency 4. API CPU/request: 29.9ms / 39.6ms respectively. Post-GC heap 24.14→24.26MiB over 30 mixed windows; peak sampled RSS 261.6MiB; external memory 2.82MiB remained flat; pool clients returned at every checkpoint. Finite approximately 69-second run provides screening evidence, not proof of all leak absence or production capacity. PostgreSQL CPU is not measured. Persistent idempotency storage growth is expected and reported separately.

Verification: lint, Nest build, TypeScript, 171 unit tests, 121 integration tests passed; benchmark metrics have three focused regression tests. Independent reviewer matched committed summary values to raw JSON and found no blockers. Local raw reports live under the Git-excluded bulk performance plan; docs/bulk-performance.md preserves methodology and reviewed results. History/PR benchmarks remain Phase 06 work. No unresolved diagnosis required problem-solving. Existing Compose edit and assignment PDF preserved.


## 8. Visible benchmark/service logs — 2026-10-09

User wanted proof that the real service runs and visible performance output. Their local changes selected info level in the worker and report, but child stdout/stderr were still ignored. Preserved info as default, added validated PERF_LOG_LEVEL, inherited output, and printed actual isolated backend URL/PID. Debug level exposes safe WorkoutLoggingService started/completed/failed events; completion follows transaction commit. Counts, operation, outcome, duration and existing request ID are logged, excluding user IDs, idempotency keys, bodies and raw errors. Scenario summaries now include sampled RSS, post-GC heap, and throughput alongside p95/CPU.

Applied NestJS logging guidance, security, and independent code review. Debug benchmark passed with 1,743 service starts, 1,243 completions and 500 expected scenario failures; checks confirmed no synthetic user IDs, keys, or body-field markers in logs. Report records debug level. Logging overhead is included; documentation preserves the historical silent baseline and distinguishes transaction duration from full HTTP latency. Build, TypeScript, lint, 171 unit tests, and 121 integration tests passed. Independent reviewer found no blockers.
