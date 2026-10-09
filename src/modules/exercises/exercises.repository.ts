import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { ExerciseCursor } from '../../schemas/exercise-query.schema';
import { DEFAULT_PAGE_SIZE } from '../../schemas/pagination.schema';
import type { Exercise } from './exercise.types';
import { LIST_EXERCISES_SQL, RESOLVE_EXERCISES_SQL } from './exercise.queries';

@Injectable()
export class ExercisesRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(
    limit = DEFAULT_PAGE_SIZE,
    cursor?: ExerciseCursor,
    muscleGroup?: string,
  ): Promise<Exercise[]> {
    const result = await this.database.pool.query<Exercise>(
      LIST_EXERCISES_SQL,
      [
        cursor?.normalizedName ?? null,
        cursor?.id ?? null,
        limit + 1,
        muscleGroup ?? null,
      ],
    );
    return result.rows;
  }

  async findByNormalizedNames(
    client: PoolClient,
    normalizedNames: string[],
  ): Promise<Exercise[]> {
    const result = await client.query<Exercise>(RESOLVE_EXERCISES_SQL, [
      normalizedNames,
    ]);
    return result.rows;
  }
}
