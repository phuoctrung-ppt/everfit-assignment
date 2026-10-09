/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`CREATE INDEX exercises_cursor_idx
    ON exercises (normalized_name COLLATE "C", id)`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX exercises_cursor_idx');
};
