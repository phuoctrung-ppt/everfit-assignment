import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { isTransientDatabaseError } from '../../database/database-errors';
import type { ExerciseList } from '../../schemas/exercise.schema';
import { normalizeExerciseName, type Exercise } from './exercise.types';
import { ExercisesRepository } from './exercises.repository';

@Injectable()
export class ExercisesService {
  constructor(private readonly exercises: ExercisesRepository) {}

  async list(): Promise<ExerciseList> {
    const exercises = await this.runQuery(() => this.exercises.list());
    return {
      data: exercises.map(({ id, name, muscleGroups }) => ({
        id,
        name,
        muscleGroups,
      })),
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
