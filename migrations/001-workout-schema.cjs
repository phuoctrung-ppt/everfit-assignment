/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE exercises (
      id uuid PRIMARY KEY,
      name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
      normalized_name varchar(200) NOT NULL UNIQUE,
      CONSTRAINT exercises_normalized_name_check
        CHECK (normalized_name = lower(btrim(name)))
    );

    CREATE TABLE muscle_groups (
      id uuid PRIMARY KEY,
      name varchar(80) NOT NULL UNIQUE,
      CONSTRAINT muscle_groups_name_check
        CHECK (length(name) BETWEEN 1 AND 80 AND name = lower(btrim(name)))
    );

    CREATE TABLE exercise_muscle_groups (
      exercise_id uuid NOT NULL REFERENCES exercises(id),
      muscle_group_id uuid NOT NULL REFERENCES muscle_groups(id),
      PRIMARY KEY (exercise_id, muscle_group_id)
    );

    CREATE TABLE workout_entries (
      id uuid PRIMARY KEY,
      user_id varchar(128) NOT NULL CHECK (user_id ~ '^[A-Za-z0-9_-]{1,128}$'),
      exercise_id uuid NOT NULL REFERENCES exercises(id),
      performed_at timestamptz(3) NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE workout_sets (
      id uuid PRIMARY KEY,
      entry_id uuid NOT NULL REFERENCES workout_entries(id),
      position integer NOT NULL CHECK (position >= 1),
      reps integer NOT NULL CHECK (reps BETWEEN 1 AND 10000),
      original_weight numeric(13,6) NOT NULL
        CHECK (original_weight BETWEEN 0 AND 1000000),
      original_unit text NOT NULL CHECK (length(original_unit) > 0),
      weight_kg numeric(24,14) NOT NULL
        CHECK (weight_kg >= 0 AND weight_kg <> 'NaN'::numeric),
      UNIQUE (entry_id, position)
    );

    CREATE TABLE idempotency_requests (
      user_id varchar(128) NOT NULL CHECK (user_id ~ '^[A-Za-z0-9_-]{1,128}$'),
      key varchar(128) NOT NULL CHECK (key COLLATE "C" ~ '^[!-~]{1,128}$'),
      fingerprint text NOT NULL,
      response_status integer,
      response_body jsonb,
      created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, key)
    );

    CREATE INDEX workout_entries_user_history_idx
      ON workout_entries (user_id, performed_at DESC, id DESC);
    CREATE INDEX workout_entries_user_exercise_history_idx
      ON workout_entries (user_id, exercise_id, performed_at DESC, id DESC);
    CREATE INDEX exercise_muscle_groups_reverse_idx
      ON exercise_muscle_groups (muscle_group_id, exercise_id);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE idempotency_requests;
    DROP TABLE workout_sets;
    DROP TABLE workout_entries;
    DROP TABLE exercise_muscle_groups;
    DROP TABLE muscle_groups;
    DROP TABLE exercises;
  `);
};
