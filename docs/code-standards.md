# Code Standards & Project Structure

These standards apply to the Everfit Workout Logging API and its Codex-assisted development. They describe expectations for implementation; the workspace includes the foundation, units/catalog, atomic logging, filtered history, personal records with period comparisons, Phase 06 concurrency/performance verification, and Phase 07 runtime/delivery checks.

## Project Context and Instructions

Read [AGENTS.md](../AGENTS.md), [development rules](../workflow/development-rules.md), and [documentation management](../workflow/documentation-management.md) before working on a task. Read the project README when available; until then, use [Backend Engineer.pdf](../Backend%20Engineer.pdf) for requirements.

The assignment requires Node.js, recommends NestJS, and permits PostgreSQL or MongoDB. Justify choosing a framework other than NestJS. The installed skills support a NestJS approach, but database, ORM, validation library, package manager, and runtime versions must be documented when selected. Installing a skill does not select a dependency.

Authentication is outside the assignment scope: accept and validate `userId` as a parameter. Keep implementation focused on workout logging, history, and personal records.

## Core Principles

- **YAGNI:** Implement the assignment requirements without speculative infrastructure.
- **KISS:** Prefer small modules, clear data flow, and straightforward calculations.
- **DRY:** Keep unit conversion, validation contracts, and personal-record formulas in one place.
- Keep individual code files under 200 lines, as required by the development rules. Split by responsibility, not arbitrary line ranges.
- Review existing code before adding abstractions. Change existing files directly when appropriate.
- Document assumptions and trade-offs; distinguish proposed behavior from implemented and verified behavior.

## Agent and Documentation Setup

```text
everfit-assignment/
├── .agents/skills/                   # Task-specific instructions
│   ├── code-review/
│   ├── databases/
│   ├── devops/
│   ├── nestjs-skills/
│   ├── problem-solving/
│   ├── security/
│   └── zod-validation/
├── docs/
│   └── code-standards.md
├── plans/                           # Estimates and implementation planning artifacts
├── workflow/
│   ├── development-rules.md
│   └── documentation-management.md
├── AGENTS.md                        # Project instructions
├── AI_WORKFLOW.md                   # AI setup and usage record
└── Backend Engineer.pdf             # Assignment requirements
```

Personal Codex settings are documented in [AI_WORKFLOW.md](../AI_WORKFLOW.md). Keep model selection and reasoning preferences there; application code must not depend on the coding agent's model configuration.

Use the relevant skill for each task. The `super-powers` plugin supports brainstorming and planning with human input; save its project plans using the local documentation rules. A request for a reviewer agent describes a role and does not imply that a custom agent definition file already exists.

Save plans under `plans/YYYYMMDD-HHmm-plan-name/`, using the system clock for timestamps. Include `plan.md`, detailed `phase-XX-name.md` files, and `research/` or `reports/` when needed. Keep the overview under 80 lines and track phase status. This naming convention also applies to plans produced through plugins.

## Application Organization

Choose the final layout during planning. For a NestJS implementation:

- Organize code by feature, keeping related controllers, services, and persistence logic together.
- Controllers handle HTTP input and output; services own business rules; persistence code owns database queries.
- Use dependency injection for services and external dependencies. Keep conversion and calculation functions independently testable.
- Centralize configuration and validate required environment values at startup.
- If Zod is selected, place schemas in `src/schemas/` as specified by the local validation skill, infer TypeScript types from them, and reuse them at API boundaries.
- Add shared modules only when multiple features need them. Introduce queues, caches, or additional services only with a demonstrated requirement.

## Naming and Code Style

- Use descriptive kebab-case file and directory names. NestJS role suffixes are appropriate, for example `workout-entry.controller.ts` and `unit-conversion.service.ts`.
- Preserve established filenames such as `AGENTS.md`, `AI_WORKFLOW.md`, `README.md`, and `SKILL.md`.
- Use camelCase for variables, functions, and JSON properties; PascalCase for classes and types; UPPER_SNAKE_CASE for constants.
- Use TypeScript strict checking for the application. Avoid unexplained `any` types and unchecked casts at request or database boundaries.
- Use two-space indentation and the formatter configured in the project. Favor readable code over cosmetic churn.
- Explain non-obvious decisions, precision choices, and business rules in comments. Avoid comments that only repeat the code.
- Await asynchronous work and handle rejected operations. Catch errors when adding useful context, translating an error, or recovering; avoid repetitive catch-and-rethrow blocks.

## API Contracts and Validation

- Use REST resource names and consistent request, response, and error formats. Document endpoint paths and examples in the README once implemented.
- Validate `userId`, dates, exercise names, sets, reps, weights, and units before persistence. Reject missing or malformed fields, unsupported units, negative values, and empty sets arrays.
- Define and test policies for zero values, fractional reps, numeric coercion, unknown fields, and request size limits rather than allowing accidental library defaults to decide them.
- Support single and bulk workout logging. Document whether bulk requests are atomic or allow partial success, including error behavior.
- Support exercise-name partial matching, date ranges, muscle-group filtering when metadata exists, and requested output units.
- Choose cursor or offset pagination, enforce a page-size limit, and use a stable ordering with a unique tie-breaker.
- Return a successful empty result with an appropriate message for ranges without data.
- Use appropriate HTTP status codes and structured errors. Do not expose stack traces, database internals, or secrets in client responses.

## Workout Data and Calculations

- Preserve the original weight and unit alongside a normalized value in kilograms. Initially support `kg` and `lb`.
- Centralize unit definitions and conversion so another unit can be added with minimal changes. Convert from canonical values and document precision and rounding rules.
- Compare weights and calculate personal records using consistent units. Convert response values only after comparison and calculation.
- Calculate the heaviest set by maximum weight, highest-volume set by `reps × weight`, and estimated 1RM using the required Epley formula: `weight × (1 + reps / 30)`.
- Include the achieved date for each record and support record comparisons between time ranges. Define deterministic behavior for ties and empty ranges.
- Keep exercise-to-muscle-group mappings configurable outside business logic.
- Document the timezone strategy, including accepted timestamp formats, treatment of timestamps without offsets, and date-range boundaries. Prefer UTC storage as recommended by the assignment.

## Persistence, Concurrency, and Performance

- Justify the database choice and document schema design, relationships, constraints, and indexes. Select the appropriate database guidance after that decision.
- Design indexes around actual history filters, sorting, and personal-record queries; verify them with the selected database's query-analysis tools.
- Use parameterized SQL or safe structured database queries. Never interpolate request text into query syntax.
- Handle concurrent writes without lost data. Define duplicate and retry behavior; do not assume two entries with the same user, exercise, and timestamp are necessarily duplicates.
- Use transactions or equivalent guarantees where the documented bulk-write semantics require them.
- Paginate history in the database and perform aggregations there when appropriate. Avoid loading an entire user's history into application memory for each request.
- Verify representative query behavior with 50,000+ entries per user. Record dataset size, query patterns, environment, and observed timings before making performance claims.

## Testing and Verification

Test design and relevant behavior take priority over an arbitrary coverage percentage, matching the assignment's evaluation criteria.

- Unit-test conversion, precision, volume, Epley calculations, record selection, ties, and date boundaries with explicit expected results.
- Integration-test logging, bulk behavior, history filters, pagination, requested units, record comparisons, and structured errors against the selected database.
- Cover malformed input, unsupported units, negative values, empty sets, no-data ranges, and concurrent writes.
- Check pagination stability and representative large-dataset queries. Keep expensive performance checks separately runnable.
- Use deterministic fixtures and isolate tests. Mock external dependencies where useful, but verify persistence and concurrency behavior against a real test database.
- Name tests after observable behavior. Use the chosen runner's `.spec.ts` or `.test.ts` convention consistently.
- Run checks relevant to each change and report the actual command results. Do not claim tests, builds, or performance checks passed unless they ran successfully.

## Configuration and Local Runtime

- Declare the selected Node.js version and package manager. Commit the application's lockfile for reproducible installs.
- Provide an `.env.example` with placeholders and documented variables. Exclude real environment files, credentials, build output, logs, and dependencies from version control.
- Provide Docker setup and either a working `docker compose up` path or clear step-by-step startup instructions, as required by the assignment.
- Use structured logging with useful operation context. Avoid logging secrets or unnecessary request data.
- Define lint, build/type-check, and test commands when scaffolding the application. Document what each command verifies.
- Describe CI, hooks, or automated checks as enabled only after their configuration exists and has been verified.

## Review, Git, and Documentation

- Follow the development rules: use a reviewer agent after code implementation, run linting before commits, and run tests before pushes. Address failures before proceeding.
- Keep commits small and meaningful, using Conventional Commits such as `feat(workouts): add bulk logging` or `test(records): cover mixed-unit comparisons`.
- Review generated code and inspect the diff before committing. Do not include secrets or AI attribution in commit messages.
- Keep the README aligned with implemented architecture, setup, API contracts, database decisions, and scaling trade-offs.
- Update plans and related documentation when implementation decisions or dependencies change, following the documentation rules.
- Document justified exceptions beside the affected code or in the relevant plan, and reconcile conflicting instructions before implementing the affected behavior.
