import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function assertTestDatabaseUrl(databaseUrl: string): void {
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!/^everfit_test_[a-f0-9]{32}$/.test(name)) {
    throw new Error(
      'Refusing to modify a database outside the isolated test namespace',
    );
  }
}

export async function runTestMigrations(
  databaseUrl: string,
  direction: 'up' | 'down' = 'up',
): Promise<number> {
  assertTestDatabaseUrl(databaseUrl);
  // Exercise the production migration entrypoint and its native ESM import.
  const { stdout } = await execute(
    process.execPath,
    ['scripts/migrate.cjs', direction],
    {
      cwd: resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 20000,
    },
  );
  const result = JSON.parse(stdout) as { count: number };
  return result.count;
}
