import type { Request } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { WorkoutLoggingHeadersSchema } from '../../schemas/workout-logging.schema';

export function readIdempotencyKey(request: Request): string {
  // Node joins duplicate custom headers; a comma is also a valid key character.
  const occurrences = request.rawHeaders.filter(
    (header, index) =>
      index % 2 === 0 && header.toLowerCase() === 'idempotency-key',
  ).length;
  const parsed = WorkoutLoggingHeadersSchema.safeParse({
    'idempotency-key':
      occurrences === 1 ? request.headers['idempotency-key'] : undefined,
  });
  if (!parsed.success) throw new ZodValidationException(parsed.error);
  return parsed.data['idempotency-key'];
}
