import type { z } from 'zod';
import {
  ExerciseNameSchema,
  UtcDateSchema,
  WeightUnitSchema,
} from './common.schema';
import { ExerciseListQuerySchema } from './exercise-query.schema';
import { CursorPaginationQuerySchema } from './pagination.schema';

export const HistoryQuerySchema = CursorPaginationQuerySchema.extend({
  exerciseName: ExerciseNameSchema.transform((name) =>
    name.trim().toLowerCase(),
  )
    .optional()
    .describe(
      'Case-insensitive literal exercise-name substring, trimmed; 1–200 characters.',
    ),
  muscleGroup: ExerciseListQuerySchema.shape.muscleGroup,
  from: UtcDateSchema.optional().describe('Inclusive UTC start timestamp.'),
  to: UtcDateSchema.optional().describe('Exclusive UTC end timestamp.'),
  unit: WeightUnitSchema.default('kg').describe(
    'Output weight unit; defaults to kg. Originals are preserved.',
  ),
}).refine(
  (query) =>
    !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to),
  {
    path: ['to'],
    message: 'End must be after start',
  },
);

export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
