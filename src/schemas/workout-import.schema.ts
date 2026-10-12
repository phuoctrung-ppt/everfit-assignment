import { z } from 'zod';
import { UserIdSchema, UtcDateSchema } from './common.schema';

export const WorkoutImportParamsSchema = z.object({
  userId: UserIdSchema,
  importId: z.uuid(),
});
export const WorkoutImportSchema = z.object({
  id: z.uuid(),
  userId: UserIdSchema,
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  totalEntries: z.number().int().nonnegative(),
  totalSets: z.number().int().nonnegative(),
  totalBatches: z.number().int().nonnegative(),
  completedBatches: z.number().int().nonnegative(),
  processedEntries: z.number().int().nonnegative(),
  processedSets: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  error: z
    .object({
      code: z.string(),
      record: z.number().int().positive().nullable(),
      field: z.string().nullable(),
      message: z.string(),
    })
    .nullable(),
  createdAt: UtcDateSchema,
  updatedAt: UtcDateSchema,
});
export const WorkoutImportResponseSchema = z.object({
  data: WorkoutImportSchema,
});
export type WorkoutImport = z.infer<typeof WorkoutImportSchema>;
