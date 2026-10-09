import { z } from 'zod';
import { WEIGHT_UNITS } from '../units/unit-registry';

export const UserIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const UtcDateSchema = z.iso
  .datetime()
  .regex(
    /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
    'Expected a valid UTC timestamp with seconds and at most millisecond precision',
  );

export const WeightUnitSchema = z.enum(
  Object.keys(WEIGHT_UNITS) as [
    keyof typeof WEIGHT_UNITS,
    ...(keyof typeof WEIGHT_UNITS)[],
  ],
);

export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[!-~]+$/);

// Preserve whitespace/casing for fingerprints; catalog lookup normalizes separately.
export const ExerciseNameSchema = z
  .string()
  .refine(
    (name) => !name.includes('\u0000'),
    'Exercise name must not contain NUL',
  )
  .refine(
    (name) => name.trim().length >= 1 && name.trim().length <= 200,
    'Exercise name must contain 1 to 200 characters after trimming',
  );
