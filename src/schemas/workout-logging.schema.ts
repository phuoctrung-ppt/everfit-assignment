import { z } from 'zod';
import { IdempotencyKeySchema, UserIdSchema } from './common.schema';
import { WorkoutEntrySchema } from './workout-response.schema';

export const WorkoutUserParamsSchema = z.strictObject({ userId: UserIdSchema });
export const WorkoutLoggingHeadersSchema = z.strictObject({
  'idempotency-key': IdempotencyKeySchema,
});
export const SingleWorkoutResponseSchema = z.strictObject({
  data: WorkoutEntrySchema,
});
export const BulkWorkoutResponseSchema = z.strictObject({
  data: z.array(WorkoutEntrySchema).min(1).max(100),
});
export const LoggingResultSchema = z.strictObject({
  status: z.literal(201),
  body: z.union([SingleWorkoutResponseSchema, BulkWorkoutResponseSchema]),
});
