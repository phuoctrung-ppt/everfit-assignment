import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
// JSON escaping of valid catalog names and filter values can exceed 2 KiB.
export const MAX_CURSOR_LENGTH = 4096;

export const CursorTokenSchema = z
  .string()
  .min(1)
  .max(MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);

export const CursorPaginationQuerySchema = z.strictObject({
  limit: z
    .string()
    .max(3)
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(MAX_PAGE_SIZE))
    .default(DEFAULT_PAGE_SIZE)
    .describe('Page size: positive decimal integer, default 20, maximum 100.'),
  cursor: CursorTokenSchema.optional().describe(
    'Opaque nextCursor from the previous page; omit for the first page.',
  ),
});

export const PaginationSchema = z.strictObject({
  nextCursor: CursorTokenSchema.nullable(),
  hasMore: z.boolean(),
});

export function CursorPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.strictObject({
    data: z.array(itemSchema),
    pagination: PaginationSchema,
  });
}

export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;
export type CursorPage<T> = {
  data: T[];
  pagination: z.infer<typeof PaginationSchema>;
};

export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(token: string): unknown {
  if (!CursorTokenSchema.safeParse(token).success) return undefined;
  try {
    const bytes = Buffer.from(token, 'base64url');
    // Buffer decoding alone accepts noncanonical encodings and invalid UTF-8.
    if (bytes.toString('base64url') !== token) return undefined;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}
