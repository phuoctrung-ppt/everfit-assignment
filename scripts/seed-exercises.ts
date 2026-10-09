import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateEnvironment } from '../src/config/configuration';
import { DatabaseService } from '../src/database/database.service';
import type { Environment } from '../src/schemas/environment.schema';
import { seedExerciseCatalog } from './seed-exercise-catalog';

async function main(): Promise<void> {
  const input: unknown = JSON.parse(
    await readFile(resolve(__dirname, '../data/exercise-catalog.json'), 'utf8'),
  );
  const environment = validateEnvironment(process.env);
  const database = new DatabaseService(
    new ConfigService<Environment, true>(environment),
  );
  try {
    await seedExerciseCatalog(database, input);
    process.stdout.write('Exercise catalog seeded successfully.\n');
  } finally {
    await database.onApplicationShutdown();
  }
}

void main().catch(() => {
  // Seed errors may contain connection secrets or SQL; keep CLI output sanitized.
  process.stderr.write(
    'Exercise catalog seeding failed; check configuration, catalog, and migrations.\n',
  );
  process.exitCode = 1;
});
