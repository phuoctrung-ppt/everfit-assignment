import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedExerciseCatalog } from '../scripts/seed-exercise-catalog';
import { createApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { createTestDatabase } from './support/test-database';

const encode = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');
const boundary = {
  v: 1,
  resource: 'exercises',
  normalizedName: 'bravo',
  id: '10000000-0000-4000-8000-000000000001',
};

describe('catalog cursor pagination against PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let service: DatabaseService;
  const seed = (names: string[]) =>
    seedExerciseCatalog(service, {
      muscleGroups: [{ id: randomUUID(), name: 'chest' }],
      exercises: names.map((name) => ({
        id: randomUUID(),
        name,
        muscleGroups: ['chest'],
      })),
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, {
      DATABASE_URL: database.databaseUrl,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    app = await createApplication();
    await app.init();
    service = app.get(DatabaseService);
  });
  beforeEach(async () => {
    await service.pool.query('DELETE FROM exercise_muscle_groups');
    await service.pool.query('DELETE FROM exercises');
    await service.pool.query('DELETE FROM muscle_groups');
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('traverses stable ordering without duplicates and ends at an exact page boundary', async () => {
    await seed(['Zulu', 'bravo', 'Alpha', 'Éclair']);
    const first = await request(app.getHttpServer())
      .get('/exercises?limit=2')
      .expect(200);
    expect(first.body.data.map((row: { name: string }) => row.name)).toEqual([
      'Alpha',
      'bravo',
    ]);
    expect(first.body.data[0].muscleGroups).toEqual(['chest']);
    expect(first.body.pagination).toEqual({
      hasMore: true,
      nextCursor: expect.any(String),
    });
    const second = await request(app.getHttpServer())
      .get('/exercises')
      .query({ limit: 2, cursor: first.body.pagination.nextCursor })
      .expect(200);
    expect(second.body.data.map((row: { name: string }) => row.name)).toEqual([
      'Zulu',
      'Éclair',
    ]);
    expect(second.body.pagination).toEqual({
      hasMore: false,
      nextCursor: null,
    });
  });

  it('defaults to 20 rows and accepts the maximum page size', async () => {
    await seed(Array.from({ length: 21 }, (_, index) => `Exercise ${index}`));
    const first = await request(app.getHttpServer())
      .get('/exercises')
      .expect(200);
    expect(first.body.data).toHaveLength(20);
    expect(first.body.pagination.hasMore).toBe(true);
    const all = await request(app.getHttpServer())
      .get('/exercises?limit=100')
      .expect(200);
    expect(all.body.data).toHaveLength(21);
    expect(all.body.pagination).toEqual({ hasMore: false, nextCursor: null });
  });

  it('returns an empty final page for an empty catalog or a boundary after all rows', async () => {
    for (const query of [{}, { cursor: encode(boundary) }]) {
      if ('cursor' in query) await seed(['Alpha']);
      await request(app.getHttpServer())
        .get('/exercises')
        .query(query)
        .expect(200, {
          data: [],
          pagination: { hasMore: false, nextCursor: null },
        });
    }
  });

  it('continues after a deleted boundary and ignores new rows before it', async () => {
    await seed(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const first = await request(app.getHttpServer())
      .get('/exercises?limit=2')
      .expect(200);
    await service.pool.query('DELETE FROM exercise_muscle_groups');
    await service.pool.query('DELETE FROM exercises WHERE id = $1', [
      first.body.data[1].id,
    ]);
    await service.pool.query(
      'INSERT INTO exercises (id, name, normalized_name) VALUES ($1, $2, $3)',
      [randomUUID(), 'Aardvark', 'aardvark'],
    );
    const next = await request(app.getHttpServer())
      .get('/exercises')
      .query({ limit: 2, cursor: first.body.pagination.nextCursor })
      .expect(200);
    expect(next.body.data.map((row: { name: string }) => row.name)).toEqual([
      'Charlie',
      'Delta',
    ]);
    expect(next.body.pagination).toEqual({ hasMore: false, nextCursor: null });
  });

  it('round-trips a cursor whose normalized Unicode name expands beyond 200 characters', async () => {
    await seed(['İ'.repeat(200), 'Zulu']);
    const first = await request(app.getHttpServer())
      .get('/exercises?limit=1')
      .expect(200);
    expect(first.body.data[0].name).toBe('İ'.repeat(200));
    const next = await request(app.getHttpServer())
      .get('/exercises')
      .query({ limit: 1, cursor: first.body.pagination.nextCursor })
      .expect(200);
    expect(next.body.data[0].name).toBe('Zulu');
  });

  it.each(['0', '101', '-1', '1.5', '1e2', '', 'abc'])(
    'rejects invalid page size %j',
    async (limit) => {
      const result = await request(app.getHttpServer())
        .get('/exercises')
        .query({ limit })
        .expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(result.body.error.details).toContainEqual({
        path: 'limit',
        message: 'Invalid value',
      });
      expect(result.body.requestId).toBe(result.headers['x-request-id']);
    },
  );

  it.each([
    '',
    'not-json',
    'a'.repeat(4097),
    `${encode(boundary)}=`,
    encode({ ...boundary, v: 2 }),
    encode({ ...boundary, resource: 'workouts' }),
    encode({ ...boundary, id: 'invalid' }),
    encode({ ...boundary, normalizedName: 'bad\u0000name' }),
    encode({ ...boundary, extra: true }),
  ])(
    'rejects invalid cursor %# through the global error filter',
    async (cursor) => {
      const result = await request(app.getHttpServer())
        .get('/exercises')
        .query({ cursor })
        .expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(result.body.error.details).toContainEqual({
        path: 'cursor',
        message: 'Invalid value',
      });
      expect(result.body.requestId).toBe(result.headers['x-request-id']);
    },
  );

  it.each([
    'limit=1&limit=2',
    'cursor=a&cursor=b',
    'offset=1',
    'limit[value]=2',
  ])('rejects duplicate or unknown query parameters: %s', async (query) => {
    const result = await request(app.getHttpServer())
      .get(`/exercises?${query}`)
      .expect(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(result.body.requestId).toBe(result.headers['x-request-id']);
  });
});
