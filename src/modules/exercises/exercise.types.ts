import type { ExerciseDto } from '../../schemas/exercise.schema';

export type Exercise = ExerciseDto & { normalizedName: string };

export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase();
}
