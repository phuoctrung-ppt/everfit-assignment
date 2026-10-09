import { z } from 'zod';

export const HealthResponseSchema = z.strictObject({ status: z.literal('ok') });

export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.array(z.strictObject({ path: z.string(), message: z.string() })),
  }),
  requestId: z.uuid(),
});
