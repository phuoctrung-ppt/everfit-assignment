import type { PoolClient } from 'pg';
import { RESOLVE_EXERCISES_SQL } from '../exercises/exercise.queries';
import {
  normalizeExerciseName,
  type Exercise,
} from '../exercises/exercise.types';
import { WorkoutLoggingRepository } from '../workouts/workout-logging.repository';
import { CsvImportError } from './csv-parser';
import type { StagedImportEntry } from './import-staging';

const workouts = new WorkoutLoggingRepository();

// The worker owns BEGIN/COMMIT and locks the job before invoking this helper.
export async function applyImportBatch(
  client: PoolClient,
  importId: string,
  userId: string,
): Promise<void> {
  const result = await client.query<{
    position: number;
    payload: StagedImportEntry[];
  }>(
    `SELECT position, payload FROM workout_import_batches
     WHERE import_id = $1 ORDER BY position LIMIT 1 FOR UPDATE`,
    [importId],
  );
  const batch = result.rows[0];
  if (!batch?.payload.length) throw new Error('Missing staged import batch');
  const names = [
    ...new Set(
      batch.payload.map(({ entry }) =>
        normalizeExerciseName(entry.exerciseName),
      ),
    ),
  ];
  // FOR SHARE also blocks renames (FOR KEY SHARE would not protect names).
  await client.query(
    `SELECT id FROM exercises WHERE normalized_name = ANY($1::text[])
     OR id = ANY($2::uuid[]) ORDER BY id FOR SHARE`,
    [names, batch.payload.map(({ exerciseId }) => exerciseId)],
  );
  const catalog = await client.query<Exercise>(RESOLVE_EXERCISES_SQL, [names]);
  const exercises = new Map(
    catalog.rows.map((row) => [row.normalizedName, row]),
  );
  for (const item of batch.payload) {
    if (
      exercises.get(normalizeExerciseName(item.entry.exerciseName))?.id !==
      item.exerciseId
    ) {
      throw new CsvImportError(
        'IMPORT_CATALOG_CHANGED',
        item.record,
        'exerciseName',
      );
    }
  }
  const entries = batch.payload.map(({ entry }) => entry);
  await workouts.insertEntries(client, userId, entries, exercises);
  await client.query(
    `DELETE FROM workout_import_batches WHERE import_id = $1 AND position = $2`,
    [importId, batch.position],
  );
  await client.query(
    `UPDATE workout_imports SET completed_batches = completed_batches + 1,
       processed_entries = processed_entries + $2, processed_sets = processed_sets + $3,
       status = CASE WHEN completed_batches + 1 = total_batches
         THEN 'completed' ELSE 'running' END,
       attempts = 0, error = NULL, next_attempt_at = now(), updated_at = now()
     WHERE id = $1`,
    [
      importId,
      entries.length,
      entries.reduce((sum, entry) => sum + entry.sets.length, 0),
    ],
  );
}

export async function failImport(
  client: PoolClient,
  importId: string,
  error: unknown,
): Promise<void> {
  const failure =
    error instanceof CsvImportError
      ? {
          code: error.code,
          record: error.record,
          field: error.field,
          message: 'Invalid workout CSV',
        }
      : {
          code: 'IMPORT_FAILED',
          record: null,
          field: null,
          message: 'Workout import failed',
        };
  // A single statement makes failure metadata and staging cleanup atomic.
  await client.query(
    `WITH failed AS (
       UPDATE workout_imports SET status = 'failed', source = NULL,
         error = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING id
     ) DELETE FROM workout_import_batches WHERE import_id IN (SELECT id FROM failed)`,
    [importId, JSON.stringify(failure)],
  );
}
