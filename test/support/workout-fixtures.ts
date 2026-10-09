import type { INestApplication } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { seedExerciseCatalog } from '../../scripts/seed-exercise-catalog';
import { createApplication } from '../../src/bootstrap';
import { DatabaseService } from '../../src/database/database.service';
import { ExerciseCatalogSchema } from '../../src/schemas/exercise-catalog.schema';
import type { CreateWorkoutDto } from '../../src/schemas/workout.schema';
import { createTestDatabase } from './test-database';

export const benchId = '10000000-0000-4000-8000-000000000001';
export const workout: CreateWorkoutDto = {
  date: '2026-01-02T03:04:05.123Z',
  exerciseName: ' bench PRESS ',
  sets: [
    { reps: 5, weight: 135, unit: 'lb' },
    { reps: 10, weight: 0, unit: 'kg' },
  ],
};

export function postWorkout(
  app: INestApplication,
  key: string,
  body: object = workout,
  userId = 'logging-user',
  bulk = false,
) {
  return request(app.getHttpServer())
    .post(`/users/${userId}/workout-entries${bulk ? '/bulk' : ''}`)
    .set('Idempotency-Key', key)
    .send(body);
}

export async function createWorkoutFixture() {
  const database = await createTestDatabase();
  const previousEnvironment = { ...process.env };
  Object.assign(process.env, {
    DATABASE_URL: database.databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DB_LOCK_TIMEOUT_MS: '150',
    DB_STATEMENT_TIMEOUT_MS: '1000',
  });
  let app: INestApplication | undefined;
  const start = async () => {
    app = await createApplication();
    await app.init();
    return app;
  };
  const close = async () => {
    await app?.close();
    await database.close();
    process.env = previousEnvironment;
  };
  try {
    await start();
    await seedExerciseCatalog(
      app!.get(DatabaseService),
      ExerciseCatalogSchema.parse(
        JSON.parse(await readFile('data/exercise-catalog.json', 'utf8')),
      ),
    );
    return {
      get app() {
        return app!;
      },
      get service(): DatabaseService {
        return app!.get(DatabaseService);
      },
      async restart() {
        await app!.close();
        await start();
      },
      async reset() {
        await app!
          .get(DatabaseService)
          .pool.query(
            'TRUNCATE workout_sets, workout_entries, idempotency_requests',
          );
      },
      async counts() {
        const result = await app!.get(DatabaseService).pool.query(`SELECT
          (SELECT count(*)::int FROM workout_entries) AS entries,
          (SELECT count(*)::int FROM workout_sets) AS sets,
          (SELECT count(*)::int FROM idempotency_requests) AS requests`);
        return result.rows[0];
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type WorkoutFixture = Awaited<ReturnType<typeof createWorkoutFixture>>;
