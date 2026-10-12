import type { PoolClient } from 'pg';
import type { CreateWorkoutDto } from '../../schemas/workout.schema';
import { normalizeExerciseName } from '../exercises/exercise.types';
import { CsvImportError, parseWorkoutCsv } from './csv-parser';

export interface StagedImportEntry {
  record: number;
  exerciseId: string;
  entry: CreateWorkoutDto;
}

// Called inside the worker's transaction, with the import row already locked.
export async function stageImport(
  client: PoolClient,
  importId: string,
  source: Buffer,
): Promise<void> {
  let batch: StagedImportEntry[] = [];
  let batchSets = 0;
  let totalEntries = 0;
  let totalSets = 0;
  let position = 0;
  const pinned = new Map<string, string>();
  const flush = async () => {
    if (!batch.length) return;
    const names = [
      ...new Set(
        batch.map(({ entry }) => normalizeExerciseName(entry.exerciseName)),
      ),
    ];
    const catalog = await client.query<{ id: string; normalized_name: string }>(
      `SELECT id, normalized_name FROM exercises
       WHERE normalized_name = ANY($1::text[]) ORDER BY id FOR SHARE`,
      [names],
    );
    for (const exercise of catalog.rows) {
      pinned.set(exercise.normalized_name, exercise.id);
    }
    for (const item of batch) {
      const id = pinned.get(normalizeExerciseName(item.entry.exerciseName));
      if (!id) {
        throw new CsvImportError(
          'CSV_UNKNOWN_EXERCISE',
          item.record,
          'exerciseName',
        );
      }
      item.exerciseId = id;
    }
    await client.query(
      `INSERT INTO workout_import_batches (import_id, position, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [importId, position++, JSON.stringify(batch)],
    );
    batch = [];
    batchSets = 0;
  };

  for await (const { record, entry } of parseWorkoutCsv(source)) {
    if (batch.length === 100 || batchSets + entry.sets.length > 1000) {
      await flush();
    }
    batch.push({ record, entry, exerciseId: '' });
    batchSets += entry.sets.length;
    totalEntries++;
    totalSets += entry.sets.length;
  }
  await flush();
  await client.query(
    `UPDATE workout_imports SET source = NULL, status = 'running',
       total_entries = $2, total_sets = $3, total_batches = $4,
       attempts = 0, error = NULL, next_attempt_at = now(), updated_at = now()
     WHERE id = $1`,
    [importId, totalEntries, totalSets, position],
  );
}
