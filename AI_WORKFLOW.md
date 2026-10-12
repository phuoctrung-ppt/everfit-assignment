# AI Workflow

## 1. Setup

I used Codex as my main coding agent. Before writing any application code, I spent time configuring the project so that every session starts from the same context, rules and conventions. I did this so I would not have to repeat the same instructions in every prompt, and so that the agent's output stays consistent across the seven implementation phases.

### 1.1 Project structure

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
├── plans/                            # Estimate and phased implementation plans
├── workflow/
│   ├── development-rules.md
│   └── documentation-management.md
├── AGENTS.md
└── AI_WORKFLOW.md
```

This is a shortened view of the agent-related files. Codex discovers project skills in `.agents/skills/`. Each skill has a `SKILL.md` with its name, description and instructions, plus optional scripts and references. Codex can pick a skill based on the task, or I can request one explicitly, for example with `$nestjs-skills`. See the [official skills documentation](https://learn.chatgpt.com/docs/build-skills).

### 1.2 How the setup files fit together

| File or directory | Responsibility |
| --- | --- |
| [AGENTS.md](AGENTS.md) | The entry point. Codex loads it automatically when a project session starts. It defines the agent's responsibilities and points to the development rules, documentation rules and coding standards. |
| [workflow/development-rules.md](workflow/development-rules.md) | Implementation and review expectations, simplicity principles, and the checks required before commits and pushes. |
| [workflow/documentation-management.md](workflow/documentation-management.md) | When documentation must be updated, and how plans, phase files, research and reports are organized. |
| [docs/code-standards.md](docs/code-standards.md) | Project-specific conventions: application structure, validation, workout calculations, persistence, testing and review. |
| `.agents/skills/` | Task-specific guidance (NestJS, database design, validation, security, code review, DevOps, problem-solving). |
| `plans/` | The estimate and one plan per phase, with status, dependencies and success criteria. |
| `super-powers` plugin | Brainstorming and planning with a human in the loop. It is installed separately from the project skills, and its planning output is stored in `plans/` following the documentation rules. |
| [AI_WORKFLOW.md](AI_WORKFLOW.md) | This file. It records my setup, decisions and the evidence from the work. |

The intended reading order for the agent is `AGENTS.md`, then the referenced rules and standards, then the relevant skills and the task plan. The setup files only describe how to work. Detailed development steps live in the plans.

Plans follow this layout:

```text
plans/
└── YYYYMMDD-HHmm-plan-name/
    ├── plan.md                 # Overview, phase status, dependencies
    ├── phase-01-name.md         # Detailed work and success criteria
    ├── research/               # Supporting research, when needed
    └── reports/                # Findings and review reports, when needed
```

`plans/` is Git-excluded. For that reason, the durable evidence in the repository is the tracked code, tests and `docs/`, not the plan files.

### 1.3 Why I selected these skills and the plugin

| Skill or plugin | How I intended to use it in this assignment |
| --- | --- |
| `nestjs-skills` | Module boundaries, dependency injection, controllers/services/repositories, error handling and NestJS testing. Its context builder script selects the references that match the current task, so the agent does not load generic material. |
| `databases` | PostgreSQL design. I chose PostgreSQL for relational constraints, atomic logging and SQL-based personal-record selection. Also used for indexing and `EXPLAIN ANALYZE` checks. |
| `zod-validation` | Request schemas and inferred TypeScript types for dates, units, sets, reps, weights and cursors. |
| `security` | Input handling, secrets management and error sanitization. Authentication is explicitly out of scope for the assignment. |
| `code-review` | Reviewing generated changes against the requirements, questioning unnecessary complexity, and requiring verification before anything is called complete. |
| `devops` | Docker and Docker Compose setup, environment configuration and a reproducible local runtime. |
| `problem-solving` | Reasoning about unit normalization, personal-record calculations, bulk writes, concurrent requests and performance with 50,000+ entries per user. |
| `super-powers` | Brainstorming and writing plans. I chose it because it keeps me involved: it asks focused questions, presents alternatives and lets me approve the design in stages before implementation. |

Backend guidance comes from `nestjs-skills` and `databases`; there is no separate `backend` skill. The skills contain general guidance, so I adapted it to the assignment instead of following it blindly. For example, the generic ORM, class-validator and authentication examples were not adopted, because this project uses direct `pg`, Zod and no authentication.

### 1.4 Codex configuration

My personal settings live in `~/.codex/config.toml`. The relevant excerpt, with the project path replaced by a placeholder:

```toml
model = "gpt-6-astra"
model_reasoning_effort = "high"

[projects."/absolute/path/to/everfit-assignment"]
trust_level = "trusted"
```

I selected my default coding model with high reasoning effort, and marked the project as trusted. Codex supports project-level overrides in `.codex/config.toml`, but this workspace uses only my personal configuration. See the [official configuration documentation](https://learn.chatgpt.com/docs/config-file/config-basic).

In short: the personal config selects the model defaults, `AGENTS.md` connects the project rules and documentation, and `.agents/skills/` supplies specialized guidance for each task.

### 1.5 Working loop for every phase

I followed the same loop for each phase:

1. **Scope and context.** I give Codex the task, the repository rules, the assignment PDF and the approved design. I name the skills to apply, for example the NestJS context builder, PostgreSQL, Zod and code-review.
2. **Plan first.** Design and plans go through brainstorming and writing-plans before code. The plan breaks the work into phases with files, interfaces, verification steps and dependencies.
3. **Implement with delegation.** The main agent implements the core change (contracts, modules, services, SQL). I delegate bounded pieces to subagents with separate file ownership, for example real PostgreSQL integration tests, a benchmark oracle, the CSV parser or a smoke test.
4. **Independent review.** A separate reviewer agent reads the source and the tests, reruns the focused tests and tries to break the result. Several real defects came from this step (see section 4).
5. **Verification gate.** A phase is done only after lint, Nest build, full TypeScript checking, unit tests and real PostgreSQL integration tests pass. I record what actually failed and what passed, and I do not claim a red-green cycle that did not happen.

### 1.6 Prompting and context strategy

- **Give context, not just a goal.** I supplied the assignment PDF and the repository rules instead of only asking for "a workout API".
- **Settle decisions one question at a time.** I answered one design question at a time (atomicity, retries, timezones, exercise identity, period comparison, storage). This avoided building on assumptions.
- **Review in stages.** I approved the schema, then the API contract, then the final design section before implementation.
- **Be explicit about scope.** Each prompt names the phase, the skills to use and what is out of scope (no authentication, no new dependencies unless justified).
- **Keep files small and focused.** The rules ask for simple solutions and small files, and for reviewers to question unnecessary complexity.
- **Verify, then claim.** The agent must show test or runtime evidence before saying something works. Evidence in this document distinguishes design decisions, implemented behavior and measured results.

### 1.7 Tools and how I actually used them

| Tool or guidance | Actual use |
| --- | --- |
| Codex | Assignment analysis, design, implementation, debugging, tests and documentation drafts |
| Superpowers (brainstorming, writing-plans) | Context gathering, alternatives, staged design review and phased plans |
| NestJS context builder | Selected task-matched references for modules, transactions, validation and logging |
| Subagents for implementation | Real PostgreSQL tests, benchmark oracle, CSV parser/worker, smoke tests |
| Independent reviewer agent | Source and test review, reproducing defects, rechecking fixes |
| Official PostgreSQL and node-postgres docs | Verified `NUMERIC`, JSONB behavior, indexing and single-client transactions |
| Git and local file tools | Inspected the workspace and verified documentation; not used as test evidence |

## 2. How I worked

For each phase I followed the same loop:

1. I give Codex the task, the repo rules and the approved design.
2. The main agent implements the core change. I delegate bounded pieces (for example real-PostgreSQL tests or a benchmark oracle) to subagents with separate file ownership.
3. An independent reviewer agent checks source and tests and reruns the focused tests.
4. I only treat a phase as done after lint, build, TypeScript, unit and PostgreSQL integration tests pass.

I did not accept every AI proposal. Generic ORM, class-validator and auth examples from the skills were not used because the project uses `pg`, Zod and has no authentication.

### Design decisions I made

| Topic | My decision | Result |
| --- | --- | --- |
| Stack | NestJS, PostgreSQL, Docker Compose | Direct `pg` with explicit transactions |
| Bulk logging | "atomic request" | All entries in a request succeed or roll back together |
| Retries | Use an idempotency key to avoid duplicates | Required `Idempotency-Key`, replay of the original response, 409 if the payload changes |
| Dates | UTC | Inclusive start, exclusive end |
| Exercises | Stable catalog IDs | Unknown exercise names are rejected |
| Personal records | Compare two explicit UTC periods | Computed in SQL, not in application memory |
| Pagination | Opt-in per route | Shared `CursorPaginationQuerySchema` and `CursorPage<T>` |

**Rejected option:** Codex offered treating retries as independent submissions. I rejected it because a duplicate delivery must never create duplicate workouts.

**Pagination gap:** During review I found that cursor pagination was missing at the database level. I first considered a global interceptor with a `@SkipPagination()` decorator. I chose opt-in instead because keyset pagination changes the SQL itself, so the repository needs explicit `cursor` and `limit` parameters. Opt-in also keeps Swagger and `ZodResponse` accurate per route.

## 3. Handling 50,000+ entries

The assignment requires good behavior with large datasets, not a single 50,000-entry request. I verified this in four steps, each opt-in and run against an isolated PostgreSQL database.

**1. Bulk write CPU and memory.** I seeded 51,000 entries for one user and ran 30 mixed-load windows.

- The database ended with 138,100 entries and 1,024,000 sets.
- p95 for a maximum batch (100 entries, 1,000 sets) was 91.9 ms at concurrency 1 and 321.7 ms at concurrency 4.
- Post-GC heap stayed flat (24.14 → 24.26 MiB) and the connection pool returned all clients.
- This is screening evidence, not proof of production capacity or the absence of leaks.

**2. Read performance at 50,000 entries / 150,000 sets.** The first run missed my 500 ms target and I fixed it in two query revisions:

- All-time records p95 was 637.99 ms because the plan ranked 112,500 metric rows and spilled an 8,864 KiB sort. I materialized the matching sets and selected top-one winners.
- The comparison query still failed at 598.81 ms. The planner assumed 100 periods for the JSON ranges function and triggered 220–341 ms of JIT compilation. I exposed the real array length to the planner without truncating periods or changing global JIT settings.
- After the fix, all 999 responses matched an independent BigInt oracle. Warm p95: history 3.9–7.8 ms, all-time records 130.6 ms, monthly records 30.0 ms, comparison 68.5 ms.

**3. 50,000 entries in 500 batches with retry.** The runner sends 500 batches of 100 entries.

- A bad exercise name must return 400, leave prior data intact and succeed after correction.
- A test-only SQL trigger raises a transient error on one set. I verified the rollback, then retried with the same key.
- Restart replay used a different API process and added no rows.
- Result: 50,000 entries / 150,000 sets in 22.4 s, batch p95 61 ms. A separate read-only `psql` script verified every stored value after all processes stopped.

**4. Real CSV upload with one durable worker.** I noticed that my earlier benchmarks sent JSON, not CSV. I then added multipart upload, status routes and a single worker.

- The whole file is validated before any workout write.
- Each batch commits entries, sets, progress and staging cleanup in one transaction.
- A session advisory lock keeps one active worker, and a restart resumes from the last committed checkpoint.
- Transient failures retry up to three attempts. Invalid input and permanent SQL errors fail with sanitized messages.
- Result: 50,000 entries / 150,000 sets in 18.0 s from upload to completion, including one injected failure and retry. Replay after restart preserved all IDs and values.

I also ran the README curl sequence verbatim against a fresh Compose stack (API and one worker) and checked the imported data directly in SQL.

## 4. Issues found and how I fixed them

| Issue | How it was found | Fix |
| --- | --- | --- |
| A checked-out PostgreSQL client lost its connection and crashed the process | Reviewer, then a real-DB integration test | Scoped client error listener, damaged clients are discarded; the test kills its own backend and checks the next query works |
| `new URL()` threw before Zod could sanitize the error | Config unit cases | Guard with `URL.canParse()` |
| Unsupported charset or corrupt gzip returned 500 | Reviewer sent malformed bodies | Parser middleware maps these to sanitized 400/413/415 |
| `İ Press` normalized differently in JS and PostgreSQL | Reviewer on the catalog | Migration 002 makes application normalization authoritative and backfills; real-DB regression covers Turkish İ and Greek sigma |
| Native driver errors were not `instanceof Error` (another JS realm) | Unreachable-DB HTTP test | Structural error classification, plus a cross-realm unit test |
| Cursor length limit too small after JSON escaping | Final pre-commit review | Limit raised to 4,096, with an HTTP traversal test |
| Replay required byte-equal JSON, but JSONB reorders keys | Reviewer on my plan | Contract changed to same status and deeply equal JSON |
| Benchmark could hide missing user scoping | Reviewer found secondary data duplicated primary data | Distinct weights and dates for the other user; fixture regression added |
| CSV byte limit bypassed on later records | Independent review | Explicit per-record boundary; regression after many preceding records |
| Temporary DB failures on CSV routes returned 500 | Independent review | Reuse the DB error classifier, real table-lock tests return 503 |
| Verification only compared HTTP responses and row counts | My own review against the assignment PDF | Separate PostgreSQL client with independent integer arithmetic, checks every owner, exercise, set position and weight; tests corrupt data on purpose to prove detection |
| Local logger called `err.message` as a function | Standalone probe | Replaced with a generic error serializer; a real Pino regression checks nothing leaks |

Test-evidence flaws in my own tests were also fixed. For example, count assertions inside an injected failure were swallowed as an expected 500, so counts are now captured inside the transaction and asserted outside it.

## 5. Final verification and limits

- Lint, Nest build and TypeScript pass. 386 unit tests and 285 PostgreSQL integration tests pass, including real worker crash recovery.
- A clean Compose run applies the migrations, seeds the catalog and passes a 58-request smoke test. It also covers outage recovery (sanitized 503), restart replay and graceful shutdown.
- Benchmarks are local, concurrency-1 observations. They are not production capacity claims, and PostgreSQL CPU was not measured.
- I did not invent red/green history. Where a test was added after the implementation, the notes say so.
