/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = async (pgm) => {
  const { escapeValue } = await import('node-pg-migrate');
  const { rows } = await pgm.db.query('SELECT id, name FROM exercises');
  pgm.sql(`
    ALTER TABLE exercises DROP CONSTRAINT exercises_normalized_name_check;
    ALTER TABLE exercises ALTER COLUMN normalized_name TYPE text;
  `);
  // Freeze the application's normalization policy in this migration. PostgreSQL
  // lower() differs for Unicode; lowercase expansion can exceed 200 characters.
  for (const row of rows) {
    pgm.sql(`UPDATE exercises
      SET normalized_name = ${escapeValue(row.name.trim().toLowerCase())}
      WHERE id = ${escapeValue(row.id)}`);
  }
  pgm.sql(`ALTER TABLE exercises ADD CONSTRAINT exercises_normalized_name_check
    CHECK (length(normalized_name) > 0 AND normalized_name = btrim(normalized_name))`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE exercises DROP CONSTRAINT exercises_normalized_name_check;
    UPDATE exercises SET normalized_name = lower(btrim(name));
    ALTER TABLE exercises ALTER COLUMN normalized_name TYPE varchar(200);
    ALTER TABLE exercises ADD CONSTRAINT exercises_normalized_name_check
      CHECK (normalized_name = lower(btrim(name)));
  `);
};
