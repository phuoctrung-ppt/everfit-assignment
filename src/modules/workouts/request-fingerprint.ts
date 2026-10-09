import { createHash } from 'node:crypto';
import type {
  BulkWorkoutDto,
  CreateWorkoutDto,
} from '../../schemas/workout.schema';
import type { LoggingOperation } from './logging.types';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  // Only structurally validated JSON bodies reach this helper.
  return JSON.stringify(value);
}

export function requestFingerprint(
  userId: string,
  operation: LoggingOperation,
  body: CreateWorkoutDto | BulkWorkoutDto,
): string {
  return createHash('sha256')
    .update(stableJson({ version: 1, userId, operation, body }))
    .digest('hex');
}
