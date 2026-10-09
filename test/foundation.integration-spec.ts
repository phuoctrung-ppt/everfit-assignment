import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { createTestDatabase } from './support/test-database';

describe('foundation against PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let service: DatabaseService;

  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_URL = database.databaseUrl;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    Object.assign(process.env, {
      PORT: '3000',
      DB_POOL_MAX: '10',
      DB_STATEMENT_TIMEOUT_MS: '5000',
      DB_LOCK_TIMEOUT_MS: '3000',
    });
    app = await createApplication();
    await app.init();
    service = app.get(DatabaseService);
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('returns database readiness and a fresh request ID', async () => {
    const result = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'untrusted')
      .expect(200);
    expect(result.body).toEqual({ status: 'ok' });
    expect(result.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.headers['x-request-id']).not.toBe('untrusted');
  });

  it('does not apply pagination validation or response wrapping to an opted-out route', async () => {
    await request(app.getHttpServer())
      .get('/health?cursor=invalid&limit=0')
      .expect(200, { status: 'ok' });
  });

  it('rolls back a throwing callback and releases its client', async () => {
    const id = randomUUID();
    await expect(
      service.withTransaction(async (client) => {
        await client.query(
          'INSERT INTO exercises (id, name, normalized_name) VALUES ($1, $2, $3)',
          [id, 'Rollback', 'rollback'],
        );
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    expect(
      (await service.pool.query('SELECT id FROM exercises WHERE id = $1', [id]))
        .rowCount,
    ).toBe(0);
    expect(service.pool.waitingCount).toBe(0);
    expect(service.pool.idleCount).toBe(service.pool.totalCount);
  });

  it('commits a successful callback and preserves its return value', async () => {
    const id = randomUUID();
    const result = await service.withTransaction(async (client) => {
      await client.query(
        'INSERT INTO exercises (id, name, normalized_name) VALUES ($1, $2, $3)',
        [id, 'Commit', 'commit'],
      );
      return id;
    });
    expect(result).toBe(id);
    expect(
      (await service.pool.query('SELECT id FROM exercises WHERE id = $1', [id]))
        .rowCount,
    ).toBe(1);
  });

  it('discards a disconnected transaction client and permits subsequent work', async () => {
    await expect(
      service.withTransaction(async (client) => {
        await client.query('SELECT pg_terminate_backend(pg_backend_pid())');
      }),
    ).rejects.toThrow();
    await expect(service.pool.query('SELECT 1')).resolves.toMatchObject({
      rowCount: 1,
    });
    expect(service.pool.waitingCount).toBe(0);
  });

  it('keeps NUMERIC as strings and uses UTC plus configured timeouts', async () => {
    const result = await service.pool.query(
      'SELECT 0.45359237000001::numeric AS weight',
    );
    expect(result.rows[0].weight).toBe('0.45359237000001');
    expect((await service.pool.query('SHOW timezone')).rows[0].TimeZone).toBe(
      'UTC',
    );
    expect(
      (await service.pool.query('SHOW statement_timeout')).rows[0]
        .statement_timeout,
    ).toBe('5s');
    expect(
      (await service.pool.query('SHOW lock_timeout')).rows[0].lock_timeout,
    ).toBe('3s');
    expect(app.get(ConfigService).get('PORT')).toBe(3000);
  });

  it('uses the shared envelope for malformed JSON and oversized bodies', async () => {
    for (const [body, status, code] of [
      ['{"secret":', 400, 'VALIDATION_ERROR'],
      [
        JSON.stringify({ secret: 'x'.repeat(1024 * 1024) }),
        413,
        'PAYLOAD_TOO_LARGE',
      ],
    ] as const) {
      const result = await request(app.getHttpServer())
        .post('/health')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(status);
      expect(result.body.error.code).toBe(code);
      expect(result.body.requestId).toBe(result.headers['x-request-id']);
      expect(JSON.stringify(result.body)).not.toContain('secret');
    }
  });

  it('returns a sanitized 503 when the database is unavailable', async () => {
    await service.pool.end();
    const result = await request(app.getHttpServer())
      .get('/health')
      .expect(503);
    expect(result.body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service unavailable',
      details: [],
    });
    expect(result.body.requestId).toBe(result.headers['x-request-id']);
  });
});
