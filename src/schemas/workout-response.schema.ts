import { z } from 'zod';
import { UserIdSchema, UtcDateSchema, WeightUnitSchema } from './common.schema';
import { ExerciseSchema } from './exercise.schema';

export const WorkoutSetResponseSchema = z.strictObject({
  id: z.uuid(),
  position: z.number().int().min(1).max(100),
  reps: z.number().int().min(1).max(10000),
  weight: z.string().regex(/^(?:0|[1-9]\d*)\.\d{4}$/),
  unit: WeightUnitSchema,
  originalWeight: z.string().regex(/^(?:0|[1-9]\d*)\.\d{6}$/),
  originalUnit: WeightUnitSchema,
});

export const WorkoutEntrySchema = z.strictObject({
  id: z.uuid(),
  userId: UserIdSchema,
  date: UtcDateSchema,
  createdAt: UtcDateSchema,
  exercise: ExerciseSchema,
  sets: z.array(WorkoutSetResponseSchema).min(1).max(100),
});

export type WorkoutEntry = z.infer<typeof WorkoutEntrySchema>;
