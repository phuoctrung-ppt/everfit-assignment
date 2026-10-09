const { resolve } = require('node:path');

async function main() {
  const direction = process.argv[2];
  if (!['up', 'down'].includes(direction))
    throw new Error('Expected up or down');
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Invalid DATABASE_URL');
  }
  // Destructive rollback is intentionally restricted to isolated test databases.
  if (
    direction === 'down' &&
    !/^\/everfit_test_[a-f0-9]{32}$/.test(url.pathname)
  ) {
    throw new Error(
      'Rollback requires an isolated everfit_test_<32 hex> database',
    );
  }
  const { runner } = await import('node-pg-migrate');
  const migrations = await runner({
    databaseUrl: url.href,
    dir: resolve(__dirname, '../migrations'),
    direction,
    count: direction === 'down' ? 1 : undefined,
    migrationsTable: 'pgmigrations',
    log: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  console.log(
    JSON.stringify({
      event: 'migration_complete',
      direction,
      count: migrations.length,
    }),
  );
}

void main().catch(() => {
  console.error(
    JSON.stringify({
      event: 'migration_failed',
      message:
        'Check migration files, database configuration and target; rollback is restricted to isolated test databases',
    }),
  );
  process.exitCode = 1;
});
