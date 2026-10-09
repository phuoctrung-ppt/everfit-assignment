import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { normalizeExerciseName, type Exercise } from './exercise.types';

const exerciseSelection = `
  SELECT e.id, e.name, e.normalized_name AS "normalizedName",
    COALESCE(array_agg(mg.name ORDER BY mg.name COLLATE "C")
      FILTER (WHERE mg.id IS NOT NULL), ARRAY[]::varchar[]) AS "muscleGroups"
  FROM exercises e
  LEFT JOIN exercise_muscle_groups emg ON emg.exercise_id = e.id
  LEFT JOIN muscle_groups mg ON mg.id = emg.muscle_group_id`;

@Injectable()
export class ExercisesRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(): Promise<Exercise[]> {
    const result = await this.database.pool.query<Exercise>(`
      ${exerciseSelection}
      GROUP BY e.id ORDER BY e.normalized_name COLLATE "C", e.id`);
    return result.rows;
  }

  async resolveNames(
    client: PoolClient,
    names: string[],
  ): Promise<Map<string, Exercise>> {
    const normalizedNames = [...new Set(names.map(normalizeExerciseName))];
    if (normalizedNames.length === 0) return new Map();
    const result = await client.query<Exercise>(
      `${exerciseSelection}
       WHERE e.normalized_name = ANY($1::text[]) GROUP BY e.id`,
      [normalizedNames],
    );
    return new Map(
      result.rows.map((exercise) => [exercise.normalizedName, exercise]),
    );
  }
}
