import { z } from 'zod';
import { CreateWorkoutSchema, WorkoutSetSchema } from './workout.schema';

export const CSV_MAX_BYTES = 32 * 1024 * 1024;
export const CSV_MAX_ENTRIES = 50000;
export const CSV_MAX_SETS = 150000;
export const CSV_HEADER =
  'entryRef,date,exerciseName,setPosition,reps,weight,unit';

// Absolute end assertions also reject a quoted trailing newline (unlike `$`).
const positiveInteger = z
  .string()
  .regex(/^[1-9][0-9]*(?![\s\S])/)
  .transform(Number);
const decimal = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?(?![\s\S])/)
  .transform(Number);

// Validate text before conversion so coercion cannot hide invalid CSV values.
export const CsvWorkoutRowSchema = z.tuple([
  z.string().regex(/^[A-Za-z0-9_-]{1,128}(?![\s\S])/),
  CreateWorkoutSchema.shape.date,
  CreateWorkoutSchema.shape.exerciseName,
  positiveInteger.pipe(z.number().int().min(1).max(100)),
  positiveInteger.pipe(WorkoutSetSchema.shape.reps),
  decimal.pipe(WorkoutSetSchema.shape.weight),
  WorkoutSetSchema.shape.unit,
]);
