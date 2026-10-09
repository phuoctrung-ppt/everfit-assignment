import { createHash } from 'node:crypto';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { UtcDateSchema } from '../../schemas/common.schema';
import type { HistoryQuery } from '../../schemas/history-query.schema';
import { decodeCursor, encodeCursor } from '../../schemas/pagination.schema';

const HistoryCursorSchema = z.strictObject({
  version: z.literal(1),
  date: UtcDateSchema,
  id: z.uuid(),
  filterDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type HistoryCursor = z.infer<typeof HistoryCursorSchema>;

export function historyFilterDigest(
  userId: string,
  query: HistoryQuery,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        resource: 'workout-history',
        userId,
        exerciseName: query.exerciseName ?? null,
        muscleGroup: query.muscleGroup ?? null,
        from: query.from ? new Date(query.from).toISOString() : null,
        to: query.to ? new Date(query.to).toISOString() : null,
        unit: query.unit,
      }),
    )
    .digest('hex');
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return encodeCursor(cursor);
}

export function decodeHistoryCursor(
  value: string,
  expectedDigest: string,
): HistoryCursor {
  const result = z
    .strictObject({
      cursor: HistoryCursorSchema.refine(
        (cursor) => cursor.filterDigest === expectedDigest,
        'Cursor does not match the requested filters',
      ),
    })
    .safeParse({ cursor: decodeCursor(value) });
  if (!result.success) throw new ZodValidationException(result.error);
  return result.data.cursor;
}
