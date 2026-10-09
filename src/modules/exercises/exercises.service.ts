import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ZodValidationException } from 'nestjs-zod';
import { isTransientDatabaseError } from '../../database/database-errors';
import type { ExerciseDto } from '../../schemas/exercise.schema';
import {
  ExerciseCursorSchema,
  ExerciseCursorQuerySchema,
  type ExerciseListQuery,
} from '../../schemas/exercise-query.schema';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  type CursorPage,
} from '../../schemas/pagination.schema';
import { normalizeExerciseName, type Exercise } from './exercise.types';
import { ExercisesRepository } from './exercises.repository';

@Injectable()
export class ExercisesService {
  constructor(private readonly exercises: ExercisesRepository) {}

  async list(
    query: ExerciseListQuery = { limit: DEFAULT_PAGE_SIZE },
  ): Promise<CursorPage<ExerciseDto>> {
    const validation = ExerciseCursorQuerySchema.safeParse({
      cursor: query.cursor,
      muscleGroup: query.muscleGroup,
    });
    if (!validation.success) throw new ZodValidationException(validation.error);
    const cursor = query.cursor
      ? ExerciseCursorSchema.parse(decodeCursor(query.cursor))
      : undefined;
    const exercises = await this.runQuery(() =>
      this.exercises.list(query.limit, cursor, validation.data.muscleGroup),
    );
    const hasMore = exercises.length > query.limit;
    const page = exercises.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(({ id, name, muscleGroups }) => ({
        id,
        name,
        muscleGroups,
      })),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                v: 1,
                resource: 'exercises',
                normalizedName: last.normalizedName,
                id: last.id,
                muscleGroup: validation.data.muscleGroup ?? null,
              })
            : null,
      },
    };
  }

  async resolveNames(
    client: PoolClient,
    names: string[],
  ): Promise<Map<string, Exercise>> {
    const normalizedNames = [...new Set(names.map(normalizeExerciseName))];
    if (normalizedNames.length === 0) return new Map();
    const exercises = await this.runQuery(() =>
      this.exercises.findByNormalizedNames(client, normalizedNames),
    );
    return new Map(
      exercises.map((exercise) => [exercise.normalizedName, exercise]),
    );
  }

  async resolveName(name: string): Promise<Exercise | undefined> {
    return this.runQuery(() =>
      this.exercises.findByNormalizedName(normalizeExerciseName(name)),
    );
  }

  private async runQuery<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isTransientDatabaseError(error))
        throw new ServiceUnavailableException();
      throw error;
    }
  }
}
