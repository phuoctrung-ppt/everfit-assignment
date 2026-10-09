# Everfit Workout Logging API

Phase 01 foundation: runnable NestJS service, PostgreSQL schema, validated configuration, structured logs, and isolated database tests. Workout logging, catalog, history, and personal records are planned in subsequent phases. The only implemented endpoint is `GET /health`.

## Local startup

Requires Docker with Compose. Copy the example and replace its password in all three locations (`POSTGRES_PASSWORD` and both URLs):

```sh
cp .env.example .env
# Edit .env. Use a URL-safe password for Compose (letters/digits/hyphen/underscore).
docker compose up --build -d
curl http://localhost:3000/health
```

Compose waits for PostgreSQL, runs migrations in a separate one-shot service, then starts the API as the non-root `node` user. PostgreSQL data lives in the named `postgres-data` volume. Both published ports bind to localhost. `docker compose down` retains data. Do not remove volumes unless their data is disposable.

For host development, install Node **24.21.0** and pnpm **12.9.1**, then:

```sh
pnpm install --frozen-lockfile
docker compose up postgres -d
pnpm db:migrate
pnpm start:dev
```

For the compiled host application, use `pnpm build && pnpm start`. Scripts load `.env` using Node; existing environment variables take precedence. If changing `POSTGRES_PORT`, update both host URLs. Compose uses its internal PostgreSQL hostname and fixed port.

## Configuration

| Variable                  | Default / constraint                                  |
| ------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`            | Required PostgreSQL URL with host and database name   |
| `PORT`                    | 3000; integer 1–65535                                 |
| `NODE_ENV`                | `development`; `development`, `test`, or `production` |
| `LOG_LEVEL`               | `info`; Pino levels or `silent`                       |
| `DB_POOL_MAX`             | 10; integer 1–100                                     |
| `DB_STATEMENT_TIMEOUT_MS` | 5000; integer 1–300000                                |
| `DB_LOCK_TIMEOUT_MS`      | 3000; integer 1–300000                                |
| `TEST_DATABASE_ADMIN_URL` | Test-only admin connection with CREATEDB permission   |

Invalid configuration stops startup before listening and reports field names without values. Pool acquisition/connect timeout is 3 seconds; idle connections expire after 30 seconds. Database sessions use UTC. No global NUMERIC parser is registered: decimal values remain strings.

## Architecture and schema

`AppModule` imports configuration, logging, database, and feature-local health modules. The database service owns one bounded pool; transactions use one checked-out client and always release it. A failed rollback destroys that client. Shutdown hooks close the pool. `src/schemas/` owns Zod contracts; API DTOs use strict Zod objects and the global validation pipe.

PostgreSQL fits the required relationships, atomic bulk operations, uniqueness constraints, and future analytical queries. Migration `001-workout-schema.cjs` creates:

- `exercises`, `muscle_groups`, and `exercise_muscle_groups` for configurable catalog metadata.
- `workout_entries` with user/exercise IDs and UTC timestamps; concurrent same-time entries are permitted.
- `workout_sets` with ordered positions, reps, original `numeric(13,6)` weight/unit, and normalized `numeric(24,14)` kg.
- `idempotency_requests` with a user/key primary key and response storage for Phase 03.

Indexes support descending user history and user/exercise history, ordered sets, and reverse muscle-group lookup. Foreign keys prevent catalog deletion from removing historical data. Constraints enforce bounds and uniqueness. Supported weight units and decimal input precision will be validated at the API boundary in later phases; PostgreSQL NUMERIC itself rounds excess scale.

`pnpm db:migrate` applies pending migrations under the migration runner's lock/transaction; repeating it is a no-op. `pnpm db:rollback` permits only isolated `everfit_test_<32 hex>` database names. Never manually run destructive migration APIs against a database with valuable data.

## Health and errors

`GET /health` runs `SELECT 1`: 200 with `{"status":"ok"}`, or 503 when the database is unavailable. This checks database connectivity, not the catalog or migration version; Compose guarantees migration ordering.

Every HTTP response gets a newly generated `x-request-id`. Client-provided IDs are ignored. Errors use:

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Service unavailable",
    "details": []
  },
  "requestId": "generated-uuid"
}
```

Validation produces 400 `VALIDATION_ERROR` with `{path, message}` details. JSON bodies over 1 MiB produce 413 `PAYLOAD_TOO_LARGE`; unsupported body encodings produce 415 `UNSUPPORTED_MEDIA_TYPE`; unexpected errors produce sanitized 500 `INTERNAL_ERROR`; unknown routes produce 404 `NOT_FOUND`. Logs are JSON, with request ID/status and no request bodies, headers, URLs, or raw database errors. Authentication is outside the assignment scope; localhost binding is appropriate for this development scaffold.

## Verification

```sh
pnpm lint
pnpm build
pnpm test:unit --runInBand
pnpm test:integration --runInBand
```

Integration tests require `TEST_DATABASE_ADMIN_URL` pointing to a dedicated local/test PostgreSQL server. They create random `everfit_test_<32 hex>` databases, apply migrations, and drop only their generated databases on cleanup. Never point this variable at a production server. No test uses the development database as its cleanup target.

Tests cover configuration, startup failure, real database readiness, transaction rollback, exact NUMERIC values, session timeouts, schema constraints, repeated migration, rollback/reapply, and the HTTP validation/error boundary. No performance claims or 50,000-entry benchmarks have been made yet.

## Dependency choices and compatibility sources

Exact dependency versions are in `package.json` and `pnpm-lock.yaml`; image tags are pinned in Compose/Dockerfile. The foundation uses NestJS **11.2.7**, PostgreSQL **17.11**, TypeScript **5.9.3**, pg **8.23.1**, node-pg-migrate **9.0.0**, Zod **4.6.5**, nestjs-zod **5.5.0**, nestjs-pino **5.3.1**, and Jest **30.5.2**. Install scripts for optional native tooling and Nest's postinstall message are disabled in `pnpm-workspace.yaml`; the application uses plain JavaScript PostgreSQL and TypeScript compilation.

- [Node release schedule](https://nodejs.org/en/about/previous-releases): Node 24 is the selected LTS runtime.
- [Nest migration requirements](https://docs.nestjs.com/migration-guide) and [nestjs-zod](https://github.com/BenLorantfy/nestjs-zod): retain Nest 11 because nestjs-zod 5.5.0 declares Nest 10/11 peers, not Nest 12; verified through published package metadata.
- [nestjs-pino](https://github.com/iamolegga/nestjs-pino): published peers accept Nest 11, Pino 10, and pino-http 11.
- [PostgreSQL support policy](https://www.postgresql.org/support/versioning/): PostgreSQL 17 remains supported; use its current 17.11 minor release.
- [node-postgres transactions](https://node-postgres.com/features/transactions): use one client for the transaction.
- [node-pg-migrate](https://salsita.github.io/node-pg-migrate/): version 9 runs through native ESM imports in the migration script; the Nest application remains CommonJS.

The full intended API and numerical rules are in [the design](docs/workout-api-design.md). Future phases implement business endpoints, concurrency verification, measured query tuning, and delivery hardening. At scale, first add authentication, retention policy, and measured pool/index tuning; caches and precomputed records require evidence.
