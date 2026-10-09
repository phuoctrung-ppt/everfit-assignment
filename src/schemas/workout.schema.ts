import Decimal from 'decimal.js';
import { z } from 'zod';
import {
  ExerciseNameSchema,
  UtcDateSchema,
  WeightUnitSchema,
} from './common.schema';

export const WorkoutSetSchema = z.strictObject({
  reps: z.number().int().min(1).max(10000),
  weight: z
    .number()
    .min(0)
    .max(1000000)
    .refine(
      (weight) => new Decimal(weight.toString()).decimalPlaces() <= 6,
      'Weight must have at most six decimal places',
    ),
  unit: WeightUnitSchema,
});

export const CreateWorkoutSchema = z.strictObject({
  date: UtcDateSchema,
  exerciseName: ExerciseNameSchema,
  sets: z.array(WorkoutSetSchema).min(1).max(100),
});

export type CreateWorkoutDto = z.infer<typeof CreateWorkoutSchema>;

export const BulkWorkoutSchema = z
  .strictObject({
    entries: z.array(CreateWorkoutSchema).min(1).max(100),
  })
  .refine(
    ({ entries }) =>
      entries.reduce((total, entry) => total + entry.sets.length, 0) <= 1000,
    { message: 'A request must contain at most 1000 sets', path: ['entries'] },
  );

export type BulkWorkoutDto = z.infer<typeof BulkWorkoutSchema>;
