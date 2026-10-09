import type { Exercise } from '../exercises/exercise.types';
import type { WorkoutEntry } from '../../schemas/workout-response.schema';
import { formatWeight } from '../../units/weight-conversion';
import type { StoredWorkoutEntry, StoredWorkoutSet } from './logging.types';

export function mapWorkoutEntry(
  entry: StoredWorkoutEntry,
  exercise: Exercise,
  sets: StoredWorkoutSet[],
): WorkoutEntry {
  return {
    id: entry.id,
    userId: entry.user_id,
    date: entry.performed_at.toISOString(),
    createdAt: entry.created_at.toISOString(),
    exercise: {
      id: exercise.id,
      name: exercise.name,
      muscleGroups: exercise.muscleGroups,
    },
    sets: [...sets]
      .sort((a, b) => a.position - b.position)
      .map((set) => ({
        id: set.id,
        position: set.position,
        reps: set.reps,
        weight: formatWeight(set.weight_kg, 'kg'),
        unit: 'kg',
        originalWeight: set.original_weight,
        originalUnit: set.original_unit,
      })),
  };
}
