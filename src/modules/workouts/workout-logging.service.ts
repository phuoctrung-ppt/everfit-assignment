import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { DatabaseService } from '../../database/database.service';
import { isTransientDatabaseError } from '../../database/database-errors';
import {
  BulkWorkoutSchema,
  CreateWorkoutSchema,
  type BulkWorkoutDto,
  type CreateWorkoutDto,
} from '../../schemas/workout.schema';
import {
  LoggingResultSchema,
  WorkoutLoggingHeadersSchema,
  WorkoutUserParamsSchema,
} from '../../schemas/workout-logging.schema';
import { ExercisesService } from '../exercises/exercises.service';
import { normalizeExerciseName } from '../exercises/exercise.types';
import { IdempotencyRepository } from './idempotency.repository';
import { WorkoutLoggingRepository } from './workout-logging.repository';
import { requestFingerprint } from './request-fingerprint';
import type { LoggingOperation, LoggingResult } from './logging.types';
import type { WorkoutEntry } from '../../schemas/workout-response.schema';

@Injectable()
export class WorkoutLoggingService {
  private readonly logger = new Logger(WorkoutLoggingService.name);
  constructor(
    private readonly database: DatabaseService,
    private readonly exercises: ExercisesService,
    private readonly idempotency: IdempotencyRepository,
    private readonly workouts: WorkoutLoggingRepository,
  ) {}

  log(
    userId: string,
    key: string,
    operation: 'single',
    body: CreateWorkoutDto,
  ): Promise<{ status: 201; body: { data: WorkoutEntry } }>;
  log(
    userId: string,
    key: string,
    operation: 'bulk',
    body: BulkWorkoutDto,
  ): Promise<{ status: 201; body: { data: WorkoutEntry[] } }>;
  async log(
    userId: string,
    key: string,
    operation: LoggingOperation,
    body: CreateWorkoutDto | BulkWorkoutDto,
  ): Promise<LoggingResult> {
    const params = WorkoutUserParamsSchema.safeParse({ userId });
    const headers = WorkoutLoggingHeadersSchema.safeParse({
      'idempotency-key': key,
    });
    const parsed = (
      operation === 'single' ? CreateWorkoutSchema : BulkWorkoutSchema
    ).safeParse(body);
    for (const validation of [params, headers]) {
      if (!validation.success)
        throw new ZodValidationException(validation.error);
    }
    if (!parsed.success) throw new ZodValidationException(parsed.error);
    const validatedBody = parsed.data;
    const entries =
      'entries' in validatedBody ? validatedBody.entries : [validatedBody];
    const fingerprint = requestFingerprint(userId, operation, validatedBody);
    const started = performance.now();
    let outcome = 'created';
    this.logger.debug({
      event: 'workout_logging_started',
      operation,
      entryCount: entries.length,
      setCount: entries.reduce((total, entry) => total + entry.sets.length, 0),
    });
    try {
      const result = await this.database.withTransaction(async (client) => {
        // Explicitly override any role/database default: replay needs fresh statement snapshots.
        await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        if (
          !(await this.idempotency.reserve(client, userId, key, fingerprint))
        ) {
          const stored = await this.idempotency.find(client, userId, key);
          if (stored.fingerprint !== fingerprint) throw new ConflictException();
          outcome = 'replayed';
          return stored.result;
        }
        const exercises = await this.exercises.resolveNames(
          client,
          entries.map((entry) => entry.exerciseName),
        );
        const issues = entries.flatMap((entry, index) =>
          exercises.has(normalizeExerciseName(entry.exerciseName))
            ? []
            : [
                {
                  code: 'custom' as const,
                  path:
                    operation === 'bulk'
                      ? ['entries', index, 'exerciseName']
                      : ['exerciseName'],
                  message: 'Unknown exercise',
                },
              ],
        );
        if (issues.length)
          throw new ZodValidationException(new ZodError(issues));
        const created = await this.workouts.insertEntries(
          client,
          userId,
          entries,
          exercises,
        );
        // Validate before COMMIT so serialization errors cannot consume a key.
        const result = LoggingResultSchema.parse({
          status: 201,
          body: { data: operation === 'single' ? created[0] : created },
        });
        await this.idempotency.complete(client, userId, key, result);
        return result;
      });
      // Transaction has committed, including replay lookups, before completion is logged.
      this.logger.debug({
        event: 'workout_logging_completed',
        operation,
        outcome,
        durationMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      this.logger.debug({
        event: 'workout_logging_failed',
        operation,
        durationMs: performance.now() - started,
      });
      // Covers acquisition, BEGIN, writes and COMMIT; never automatically retry a write.
      if (isTransientDatabaseError(error))
        throw new ServiceUnavailableException();
      throw error;
    }
  }
}
