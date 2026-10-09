import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CreateWorkoutDto } from '../../schemas/workout.schema';
import type { WorkoutEntry } from '../../schemas/workout-response.schema';
import {
  formatOriginalWeight,
  normalizeWeight,
} from '../../units/weight-conversion';
import {
  normalizeExerciseName,
  type Exercise,
} from '../exercises/exercise.types';
import type { StoredWorkoutEntry, StoredWorkoutSet } from './logging.types';
import { mapWorkoutEntry } from './workout-response.mapper';

@Injectable()
export class WorkoutLoggingRepository {
  async insertEntries(
    client: PoolClient,
    userId: string,
    entries: CreateWorkoutDto[],
    exercises: Map<string, Exercise>,
  ): Promise<WorkoutEntry[]> {
    const prepared = entries.map((entry) => {
      const exercise = exercises.get(normalizeExerciseName(entry.exerciseName));
      if (!exercise) throw new Error('Unresolved exercise');
      return { id: randomUUID(), entry, exercise };
    });
    const entryRows = prepared.map(({ id, entry, exercise }) => ({
      id,
      exercise_id: exercise.id,
      performed_at: entry.date,
    }));
    const setRows = prepared.flatMap(({ id, entry }) =>
      entry.sets.map((set, index) => ({
        id: randomUUID(),
        entry_id: id,
        position: index + 1,
        reps: set.reps,
        original_weight: formatOriginalWeight(set.weight),
        original_unit: set.unit,
        weight_kg: normalizeWeight(set.weight, set.unit),
      })),
    );
    const insertedEntries = await client.query<StoredWorkoutEntry>(
      `INSERT INTO workout_entries (id, user_id, exercise_id, performed_at)
       SELECT id, $1, exercise_id, performed_at FROM jsonb_to_recordset($2::jsonb)
       AS rows(id uuid, exercise_id uuid, performed_at timestamptz)
       RETURNING id, user_id, performed_at, created_at`,
      [userId, JSON.stringify(entryRows)],
    );
    const insertedSets = await client.query<StoredWorkoutSet>(
      `INSERT INTO workout_sets
       (id, entry_id, position, reps, original_weight, original_unit, weight_kg)
       SELECT id, entry_id, position, reps, original_weight, original_unit, weight_kg
       FROM jsonb_to_recordset($1::jsonb) AS rows(
         id uuid, entry_id uuid, position integer, reps integer,
         original_weight numeric, original_unit text, weight_kg numeric)
       RETURNING id, entry_id, position, reps, original_weight, original_unit, weight_kg`,
      [JSON.stringify(setRows)],
    );
    const entryById = new Map(
      insertedEntries.rows.map((entry) => [entry.id, entry]),
    );
    const setsByEntry = new Map<string, StoredWorkoutSet[]>();
    for (const set of insertedSets.rows) {
      const group = setsByEntry.get(set.entry_id) ?? [];
      group.push(set);
      setsByEntry.set(set.entry_id, group);
    }
    return prepared.map(({ id, exercise }) => {
      const entry = entryById.get(id);
      const sets = setsByEntry.get(id);
      if (!entry || !sets) throw new Error('Workout insertion incomplete');
      return mapWorkoutEntry(entry, exercise, sets);
    });
  }
}
