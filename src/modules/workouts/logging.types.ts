import type { z } from 'zod';
import type { LoggingResultSchema } from '../../schemas/workout-logging.schema';

export type LoggingOperation = 'single' | 'bulk';
export type LoggingResult = z.infer<typeof LoggingResultSchema>;
export interface StoredIdempotencyResult {
  fingerprint: string;
  result: LoggingResult;
}
export interface StoredWorkoutEntry {
  id: string;
  user_id: string;
  performed_at: Date;
  created_at: Date;
}
export interface StoredWorkoutSet {
  id: string;
  entry_id: string;
  position: number;
  reps: number;
  original_weight: string;
  original_unit: 'kg' | 'lb';
  weight_kg: string;
}
