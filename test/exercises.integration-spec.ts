import type { INestApplication } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import request from 'supertest';
import { seedExerciseCatalog } from '../scripts/seed-exercise-catalog';
import { createApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { ExercisesRepository } from '../src/modules/exercises/exercises.repository';
import {
  ExerciseCatalogSchema,
  type ExerciseCatalog,
} from '../src/schemas/exercise-catalog.schema';
import { createTestDatabase } from './support/test-database';

describe('exercise catalog against PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let service: DatabaseService;
  let repository: ExercisesRepository;
  let catalog: ExerciseCatalog;
  const benchId = '10000000-0000-4000-8000-000000000001';

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
    repository = app.get(ExercisesRepository);
    catalog = ExerciseCatalogSchema.parse(
      JSON.parse(await readFile(resolve('data/exercise-catalog.json'), 'utf8')),
    );
    await seedExerciseCatalog(service, catalog);
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('publishes a sorted catalog and mappings without internal normalized names', async () => {
    const response = await request(app.getHttpServer())
      .get('/exercises')
      .expect(200);
    expect(response.body).toEqual({
      data: [
        {
          id: benchId,
          name: 'Bench Press',
          muscleGroups: ['chest', 'triceps'],
        },
        {
          id: '10000000-0000-4000-8000-000000000003',
          name: 'Deadlift',
          muscleGroups: ['glutes', 'hamstrings'],
        },
        {
          id: '10000000-0000-4000-8000-000000000004',
          name: 'Push Up',
          muscleGroups: ['chest', 'triceps'],
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          name: 'Squat',
          muscleGroups: ['glutes', 'quadriceps'],
        },
      ],
    });
  });

  it('seeds repeatedly without adding exercises, groups, or mappings', async () => {
    await seedExerciseCatalog(service, catalog);
    await seedExerciseCatalog(service, catalog);
    const result = await service.pool.query(`SELECT
      (SELECT count(*)::int FROM exercises) AS exercises,
      (SELECT count(*)::int FROM muscle_groups) AS groups,
      (SELECT count(*)::int FROM exercise_muscle_groups) AS mappings`);
    expect(result.rows[0]).toEqual({ exercises: 4, groups: 5, mappings: 8 });
  });

  it('resolves trimmed case-insensitive exact names, excluding unknowns and aliases', async () => {
    await service.withTransaction(async (client) => {
      const result = await repository.resolveNames(client, [
        ' bench PRESS ',
        'Bench Press',
        'Bench  Press',
        "' OR 1=1 --",
        'unknown',
      ]);
      expect([...result.keys()]).toEqual(['bench press']);
      expect(result.get('bench press')).toEqual({
        id: benchId,
        name: 'Bench Press',
        normalizedName: 'bench press',
        muscleGroups: ['chest', 'triceps'],
      });
      const query = jest.spyOn(client, 'query');
      expect(await repository.resolveNames(client, [])).toEqual(new Map());
      expect(query).not.toHaveBeenCalled();
      query.mockRestore();
    });
  });

  it('validates the complete seed before writing any catalog rows', async () => {
    const invalid = structuredClone(catalog);
    invalid.exercises.push({
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Invalid',
      muscleGroups: ['missing'],
    });
    const transaction = jest.spyOn(service, 'withTransaction');
    await expect(seedExerciseCatalog(service, invalid)).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
    transaction.mockRestore();
    const duplicate = structuredClone(catalog);
    duplicate.exercises.push({
      id: '30000000-0000-4000-8000-000000000001',
      name: ' bench PRESS ',
      muscleGroups: [],
    });
    await expect(seedExerciseCatalog(service, duplicate)).rejects.toThrow();
    expect(await repository.list()).toHaveLength(4);
  });

  it('rolls back earlier updates when a later catalog ID conflicts', async () => {
    const conflicting = structuredClone(catalog);
    conflicting.muscleGroups[0]!.name = 'changed chest';
    conflicting.exercises[0]!.muscleGroups = ['changed chest'];
    conflicting.exercises[3]!.muscleGroups = ['changed chest'];
    conflicting.exercises[3]!.id = '30000000-0000-4000-8000-000000000001';
    await expect(seedExerciseCatalog(service, conflicting)).rejects.toThrow();
    expect(
      (await repository.list()).find((exercise) => exercise.id === benchId)
        ?.muscleGroups,
    ).toEqual(['chest', 'triceps']);
    expect(await repository.list()).toHaveLength(4);
  });

  it('updates names and replaces mappings without changing historical exercise IDs', async () => {
    await service.pool.query(
      `INSERT INTO workout_entries (id, user_id, exercise_id, performed_at)
      VALUES ('40000000-0000-4000-8000-000000000001', 'catalog-test', $1, '2026-01-01T00:00:00Z')`,
      [benchId],
    );
    const updated = structuredClone(catalog);
    updated.exercises[0]!.name = 'Barbell Bench Press';
    updated.exercises[0]!.muscleGroups = ['chest'];
    updated.exercises[3]!.muscleGroups = [];
    await seedExerciseCatalog(service, updated);
    expect(
      (await repository.list()).find((exercise) => exercise.id === benchId),
    ).toMatchObject({ name: 'Barbell Bench Press', muscleGroups: ['chest'] });
    expect(
      (await repository.list()).find((exercise) => exercise.name === 'Push Up')
        ?.muscleGroups,
    ).toEqual([]);
    expect(
      (await service.pool.query('SELECT exercise_id FROM workout_entries'))
        .rows[0].exercise_id,
    ).toBe(benchId);
    await seedExerciseCatalog(service, catalog);
  });
});
