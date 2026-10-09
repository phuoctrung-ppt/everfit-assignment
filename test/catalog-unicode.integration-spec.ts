import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { seedExerciseCatalog } from '../scripts/seed-exercise-catalog';
import { validateEnvironment } from '../src/config/configuration';
import { DatabaseService } from '../src/database/database.service';
import { ExercisesRepository } from '../src/modules/exercises/exercises.repository';
import { ExercisesService } from '../src/modules/exercises/exercises.service';
import { normalizeExerciseName } from '../src/modules/exercises/exercise.types';
import type { Environment } from '../src/schemas/environment.schema';
import { runTestMigrations } from './support/migrations';
import { createTestDatabase } from './support/test-database';

describe('Unicode catalog normalization', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: DatabaseService;
  let catalogService: ExercisesService;
  beforeAll(async () => {
    database = await createTestDatabase();
    service = new DatabaseService(
      new ConfigService<Environment, true>(
        validateEnvironment({
          ...process.env,
          DATABASE_URL: database.databaseUrl,
        }),
      ),
    );
    catalogService = new ExercisesService(new ExercisesRepository(service));
  });
  afterAll(async () => {
    await service?.onApplicationShutdown();
    await database?.close();
  });

  it('backfills existing names using application normalization', async () => {
    await runTestMigrations(database.databaseUrl, 'down'); // Cursor index.
    await runTestMigrations(database.databaseUrl, 'down'); // Normalization.
    const name = "İ O'S Press";
    const id = randomUUID();
    await service.pool.query(
      'INSERT INTO exercises (id, name, normalized_name) VALUES ($1, $2::text, lower($2::text))',
      [id, name],
    );
    await runTestMigrations(database.databaseUrl);
    await service.withTransaction(async (client) => {
      const result = await catalogService.resolveNames(client, [name]);
      expect(result.get(normalizeExerciseName(name))?.id).toBe(id);
    });
  });

  it('seeds and resolves Unicode case rules and lowercase expansions repeatably', async () => {
    const exercises = ['İ Press', 'ΟΣ Press', 'İ'.repeat(200)].map((name) => ({
      id: randomUUID(),
      name,
      muscleGroups: [],
    }));
    const catalog = { muscleGroups: [], exercises };
    await seedExerciseCatalog(service, catalog);
    await seedExerciseCatalog(service, catalog);
    await service.withTransaction(async (client) => {
      const result = await catalogService.resolveNames(
        client,
        exercises.map(({ name }) => ` ${name} `),
      );
      for (const exercise of exercises) {
        expect(result.get(normalizeExerciseName(exercise.name))?.id).toBe(
          exercise.id,
        );
      }
      expect(result.size).toBe(3);
    });
  });
});
