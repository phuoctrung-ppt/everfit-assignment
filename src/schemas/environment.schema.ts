import { z } from 'zod';

const integer = (fallback: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined ? fallback : value),
    z
      .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
      .pipe(z.number().int().min(1).max(max)),
  );

export const EnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
        Boolean(url.hostname) &&
        url.pathname.length > 1
      );
    }),
  PORT: integer(3000, 65535),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DB_POOL_MAX: integer(10, 100),
  DB_STATEMENT_TIMEOUT_MS: integer(5000, 300000),
  DB_LOCK_TIMEOUT_MS: integer(3000, 300000),
});

export type Environment = z.infer<typeof EnvironmentSchema>;
