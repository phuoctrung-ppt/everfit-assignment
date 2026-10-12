/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE workout_imports (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    idempotency_key text NOT NULL,
    source_hash text NOT NULL,
    source bytea,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
    total_entries integer NOT NULL DEFAULT 0 CHECK (total_entries BETWEEN 0 AND 50000),
    total_sets integer NOT NULL DEFAULT 0 CHECK (total_sets BETWEEN 0 AND 150000),
    total_batches integer NOT NULL DEFAULT 0 CHECK (total_batches >= 0),
    completed_batches integer NOT NULL DEFAULT 0 CHECK (completed_batches BETWEEN 0 AND total_batches),
    processed_entries integer NOT NULL DEFAULT 0 CHECK (processed_entries BETWEEN 0 AND total_entries),
    processed_sets integer NOT NULL DEFAULT 0 CHECK (processed_sets BETWEEN 0 AND total_sets),
    attempts integer NOT NULL DEFAULT 0,
    retry_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    error jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id,idempotency_key),
    CHECK (source IS NULL OR octet_length(source) <= 33554432)
  );
  CREATE INDEX workout_imports_pending_idx ON workout_imports (next_attempt_at,created_at)
    WHERE status IN ('queued','running');
  CREATE TABLE workout_import_batches (
    import_id uuid NOT NULL REFERENCES workout_imports(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    payload jsonb NOT NULL,
    PRIMARY KEY (import_id,position)
  );`);
};
/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE workout_import_batches; DROP TABLE workout_imports');
};
