import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { assertTestDatabaseUrl, runTestMigrations } from './migrations';

export interface TestDatabase {
  databaseUrl: string;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl) {
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is required to create isolated test databases',
    );
  }
  const name = `everfit_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  assertTestDatabaseUrl(databaseUrl);
  const admin = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5000,
  });
  let created = false;
  let closed = false;
  const close = async () => {
    if (closed) return;
    assertTestDatabaseUrl(databaseUrl);
    const cleanup = new Client({
      connectionString: adminUrl,
      connectionTimeoutMillis: 5000,
    });
    try {
      await cleanup.connect();
      // Identifiers cannot be SQL parameters; the name is generated and strictly checked above.
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      closed = true;
    } finally {
      await cleanup.end();
    }
  };
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    await runTestMigrations(databaseUrl);
    return { databaseUrl, close };
  } catch (error) {
    if (created) await close();
    throw error;
  } finally {
    await admin.end();
  }
}
