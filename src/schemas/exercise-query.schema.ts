import { z } from 'zod';
import {
  CursorPaginationQuerySchema,
  CursorTokenSchema,
  decodeCursor,
} from './pagination.schema';

const MuscleGroupFilterSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .toLowerCase()
  .max(80)
  .refine((value) => !value.includes('\u0000'));

export const ExerciseListQuerySchema = CursorPaginationQuerySchema.extend({
  muscleGroup: MuscleGroupFilterSchema.optional().describe(
    'Exact muscle-group name, case-insensitive and trimmed (e.g. chest); omit for all groups.',
  ),
});

export const ExerciseCursorSchema = z.strictObject({
  v: z.literal(1),
  resource: z.literal('exercises'),
  // JavaScript lowercasing can expand a 200-character display name.
  normalizedName: z
    .string()
    .min(1)
    .max(600)
    .refine((name) => !name.includes('\u0000')),
  id: z.uuid(),
  // Older cursors without this field represent an unfiltered catalog.
  muscleGroup: z.string().min(1).max(80).nullable().optional(),
});

// Resource-specific cursor checks run only for the exercises route.
export const ExerciseCursorQuerySchema = z
  .strictObject({
    muscleGroup: MuscleGroupFilterSchema.optional(),
    cursor: CursorTokenSchema.refine(
      (token) => ExerciseCursorSchema.safeParse(decodeCursor(token)).success,
      'Invalid pagination cursor',
    ).optional(),
  })
  .superRefine((query, context) => {
    if (!query.cursor) return;
    const cursor = ExerciseCursorSchema.safeParse(decodeCursor(query.cursor));
    if (
      cursor.success &&
      (cursor.data.muscleGroup ?? null) !== (query.muscleGroup ?? null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'Cursor does not match the requested filters',
      });
    }
  });

export type ExerciseCursor = z.infer<typeof ExerciseCursorSchema>;
export type ExerciseListQuery = z.infer<typeof ExerciseListQuerySchema>;
