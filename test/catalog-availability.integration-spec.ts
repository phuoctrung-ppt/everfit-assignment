import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { createApplication } from '../src/bootstrap';
import { createTestDatabase } from './support/test-database';

describe('catalog database availability', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let locker: Client;
  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, {
      DATABASE_URL: database.databaseUrl,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DB_LOCK_TIMEOUT_MS: '50',
      DB_STATEMENT_TIMEOUT_MS: '1000',
    });
    app = await createApplication();
    await app.init();
    locker = new Client({ connectionString: database.databaseUrl });
    await locker.connect();
  });
  afterAll(async () => {
    await locker?.end();
    await app?.close();
    await database?.close();
  });

  it('returns 503 on a real lock timeout and recovers after the lock is released', async () => {
    await locker.query('BEGIN');
    try {
      await locker.query('LOCK TABLE exercises IN ACCESS EXCLUSIVE MODE');
      const result = await request(app.getHttpServer())
        .get('/exercises')
        .expect(503);
      expect(result.body.error).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
        details: [],
      });
    } finally {
      await locker.query('ROLLBACK');
    }
    await request(app.getHttpServer()).get('/exercises').expect(200, {
      data: [],
    });
  });
});
