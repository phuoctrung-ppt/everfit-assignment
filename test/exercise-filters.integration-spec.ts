import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedExerciseCatalog } from '../scripts/seed-exercise-catalog';
import { createApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { createTestDatabase } from './support/test-database';

describe('exercise filters with cursor pagination against PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  const fixtures = [
    { name: 'Alpha Row', muscleGroups: ['back'] },
    { name: 'Bench Press', muscleGroups: ['chest', 'triceps'] },
    { name: 'Cable Row', muscleGroups: ['back'] },
    { name: 'Dumbbell Press', muscleGroups: ['chest', 'triceps'] },
    { name: 'Push Up', muscleGroups: ['chest', 'triceps'] },
    { name: 'Zottman Curl', muscleGroups: [] },
  ].map((exercise) => ({ id: randomUUID(), ...exercise }));

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, {
      DATABASE_URL: database.databaseUrl,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    app = await createApplication();
    await app.init();
    await seedExerciseCatalog(app.get(DatabaseService), {
      muscleGroups: ['back', 'chest', 'triceps'].map((name) => ({
        id: randomUUID(),
        name,
      })),
      exercises: fixtures,
    });
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('filters before pagination, traverses all matches, and preserves every muscle group', async () => {
    let cursor: string | undefined;
    const names: string[] = [];
    for (const expected of ['Bench Press', 'Dumbbell Press', 'Push Up']) {
      const response = await request(app.getHttpServer())
        .get('/exercises')
        .query({ muscleGroup: 'chest', limit: 1, ...(cursor && { cursor }) })
        .expect(200);
      expect(response.body.data).toEqual([
        fixtures.find((exercise) => exercise.name === expected),
      ]);
      names.push(response.body.data[0].name);
      const hasMore = expected !== 'Push Up';
      expect(response.body.pagination).toEqual({
        hasMore,
        nextCursor: hasMore ? expect.any(String) : null,
      });
      cursor = response.body.pagination.nextCursor;
    }
    expect(new Set(names).size).toBe(3);
  });

  it('normalizes the filter and allows a different page size with the same cursor', async () => {
    const first = await request(app.getHttpServer())
      .get('/exercises')
      .query({ muscleGroup: ' CHEST ', limit: 1 })
      .expect(200);
    expect(first.body.data[0].name).toBe('Bench Press');
    const next = await request(app.getHttpServer())
      .get('/exercises')
      .query({
        muscleGroup: 'Chest',
        limit: 2,
        cursor: first.body.pagination.nextCursor,
      })
      .expect(200);
    expect(next.body.data).toEqual([fixtures[3], fixtures[4]]);
    expect(next.body.pagination).toEqual({ hasMore: false, nextCursor: null });
  });

  it.each([
    ['chest', 'back'],
    ['chest', undefined],
    [undefined, 'chest'],
  ])('rejects changing cursor selection from %s to %s', async (from, to) => {
    const first = await request(app.getHttpServer())
      .get('/exercises')
      .query({ limit: 1, ...(from && { muscleGroup: from }) })
      .expect(200);
    const response = await request(app.getHttpServer())
      .get('/exercises')
      .query({
        cursor: first.body.pagination.nextCursor,
        ...(to && { muscleGroup: to }),
      })
      .expect(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'cursor', message: 'Invalid value' }],
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it.each(['unknown', 'ches', "chest' OR 1=1 --", '%', '_'])(
    'returns an empty page for the exact unmatched group %j',
    async (muscleGroup) => {
      await request(app.getHttpServer())
        .get('/exercises')
        .query({ muscleGroup, limit: 1 })
        .expect(200, {
          data: [],
          pagination: { hasMore: false, nextCursor: null },
        });
    },
  );

  it.each(['', '   ', 'x'.repeat(81), 'chest\u0000'])(
    'rejects malformed muscle group %j',
    async (muscleGroup) => {
      const response = await request(app.getHttpServer())
        .get('/exercises')
        .query({ muscleGroup })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContainEqual({
        path: 'muscleGroup',
        message: 'Invalid value',
      });
    },
  );

  it.each([
    'muscleGroup=chest&muscleGroup=back',
    'muscleGroup[]=chest',
    'muscleGroup[name]=chest',
  ])(
    'rejects duplicate or structured muscle group queries: %s',
    async (query) => {
      const response = await request(app.getHttpServer())
        .get(`/exercises?${query}`)
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('keeps unfiltered requests inclusive of unmapped exercises', async () => {
    const response = await request(app.getHttpServer())
      .get('/exercises?limit=100')
      .expect(200);
    expect(response.body).toEqual({
      data: fixtures,
      pagination: { hasMore: false, nextCursor: null },
    });
  });

  it('round-trips a generated cursor with maximally escaped catalog names', async () => {
    const muscleGroup = '\u0001'.repeat(80);
    const name = '\u0001'.repeat(200);
    await seedExerciseCatalog(app.get(DatabaseService), {
      muscleGroups: [{ id: randomUUID(), name: muscleGroup }],
      exercises: [name, 'Cursor Escape Tail'].map((name) => ({
        id: randomUUID(),
        name,
        muscleGroups: [muscleGroup],
      })),
    });
    const first = await request(app.getHttpServer())
      .get('/exercises')
      .query({ muscleGroup, limit: 1 })
      .expect(200);
    expect(first.body.data[0].name).toBe(name);
    const cursor = first.body.pagination.nextCursor as string;
    expect(cursor.length).toBeGreaterThan(2048);
    const next = await request(app.getHttpServer())
      .get('/exercises')
      .query({ muscleGroup, cursor, limit: 1 })
      .expect(200);
    expect(next.body.data[0].name).toBe('Cursor Escape Tail');
    expect(next.body.pagination).toEqual({ hasMore: false, nextCursor: null });
  });
});
