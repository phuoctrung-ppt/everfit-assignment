import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { Exercise } from './exercise.types';
import { LIST_EXERCISES_SQL, RESOLVE_EXERCISES_SQL } from './exercise.queries';

@Injectable()
export class ExercisesRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(): Promise<Exercise[]> {
    const result = await this.database.pool.query<Exercise>(LIST_EXERCISES_SQL);
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
