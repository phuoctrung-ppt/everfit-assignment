import { z } from 'zod';
import { CursorPageSchema } from './pagination.schema';
import { WorkoutEntrySchema } from './workout-response.schema';

export const EMPTY_HISTORY_MESSAGE =
  'No workout entries found for the requested filters.';
export const HistoryResponseSchema = CursorPageSchema(
  WorkoutEntrySchema,
).extend({
  message: z.literal(EMPTY_HISTORY_MESSAGE).nullable(),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
