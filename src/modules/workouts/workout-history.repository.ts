import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { HistoryQuery } from '../../schemas/history-query.schema';
import type { HistoryCursor } from './history-cursor';
import type {
  HistoryEntryRow,
  HistoryPageRows,
  HistorySetRow,
} from './history.types';

// Escape LIKE's escape character and wildcards separately from SQL parameterization.
function literalSubstring(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

@Injectable()
export class WorkoutHistoryRepository {
  constructor(private readonly database: DatabaseService) {}

  async findPage(
    userId: string,
    query: HistoryQuery,
    after: HistoryCursor | null,
  ): Promise<HistoryPageRows> {
    const result = await this.database.pool.query<HistoryEntryRow>(
      `
      WITH page AS (
        SELECT w.id, w.user_id, w.performed_at, w.created_at, w.exercise_id,
          e.name AS exercise_name, e.normalized_name
        FROM workout_entries w JOIN exercises e ON e.id = w.exercise_id
        WHERE w.user_id = $1
          AND ($2::text IS NULL OR e.normalized_name LIKE $2 ESCAPE E'\\\\')
          AND ($3::text IS NULL OR EXISTS (
            SELECT 1 FROM exercise_muscle_groups emg
            JOIN muscle_groups mg ON mg.id = emg.muscle_group_id
            WHERE emg.exercise_id = w.exercise_id AND mg.name = $3
          ))
          AND ($4::timestamptz IS NULL OR w.performed_at >= $4)
          AND ($5::timestamptz IS NULL OR w.performed_at < $5)
          AND ($6::timestamptz IS NULL OR (w.performed_at, w.id) < ($6, $7::uuid))
        ORDER BY w.performed_at DESC, w.id DESC LIMIT $8
      )
      SELECT page.*, ARRAY(
        SELECT mg.name FROM exercise_muscle_groups emg
        JOIN muscle_groups mg ON mg.id = emg.muscle_group_id
        WHERE emg.exercise_id = page.exercise_id ORDER BY mg.name COLLATE "C"
      ) AS muscle_groups
      FROM page ORDER BY performed_at DESC, id DESC`,
      [
        userId,
        query.exerciseName === undefined
          ? null
          : literalSubstring(query.exerciseName),
        query.muscleGroup ?? null,
        query.from ?? null,
        query.to ?? null,
        after?.date ?? null,
        after?.id ?? null,
        query.limit + 1,
      ],
    );
    const selectedIds = result.rows
      .slice(0, query.limit)
      .map((entry) => entry.id);
    if (!selectedIds.length) return { entries: [], sets: [] };
    const sets = await this.database.pool.query<HistorySetRow>(
      `
      SELECT id, entry_id, position, reps, original_weight, original_unit, weight_kg
      FROM workout_sets WHERE entry_id = ANY($1::uuid[]) ORDER BY entry_id, position`,
      [selectedIds],
    );
    return { entries: result.rows, sets: sets.rows };
  }
}
