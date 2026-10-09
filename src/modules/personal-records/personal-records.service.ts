import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { isTransientDatabaseError } from '../../database/database-errors';
import type {
  PersonalRecordQuery,
  RecordComparisonQuery,
} from '../../schemas/personal-record-query.schema';
import type {
  RecordResponse,
  RecordComparisonResponse,
} from '../../schemas/personal-record-response.schema';
import { ExercisesService } from '../exercises/exercises.service';
import { PersonalRecordsRepository } from './personal-records.repository';
import type { RecordRange, RecordWinnerRow } from './personal-records.types';
import {
  differenceValue,
  mapRecords,
  recordMessage,
} from './record-response.mapper';

@Injectable()
export class PersonalRecordsService {
  constructor(
    private readonly exercises: ExercisesService,
    private readonly records: PersonalRecordsRepository,
  ) {}

  async get(
    userId: string,
    query: PersonalRecordQuery,
  ): Promise<RecordResponse> {
    const rows = await this.select(userId, query.exerciseName, [
      { period: 'current', from: query.from, to: query.to },
    ]);
    return { data: mapRecords(rows, query.unit), message: recordMessage(rows) };
  }

  async compare(
    userId: string,
    query: RecordComparisonQuery,
  ): Promise<RecordComparisonResponse> {
    const baselineRange = { from: query.baselineFrom, to: query.baselineTo };
    const comparisonRange = {
      from: query.comparisonFrom,
      to: query.comparisonTo,
    };
    const rows = await this.select(userId, query.exerciseName, [
      { period: 'baseline', ...baselineRange },
      { period: 'comparison', ...comparisonRange },
    ]);
    const baseline = rows.filter((row) => row.period === 'baseline');
    const comparison = rows.filter((row) => row.period === 'comparison');
    const heaviest = differenceValue(
      'heaviestSet',
      baseline,
      comparison,
      query.unit,
    );
    const volume = differenceValue(
      'highestVolumeSet',
      baseline,
      comparison,
      query.unit,
    );
    const epley = differenceValue(
      'estimatedOneRepMax',
      baseline,
      comparison,
      query.unit,
    );
    return {
      data: {
        baseline: {
          range: baselineRange,
          records: mapRecords(baseline, query.unit),
          message: recordMessage(baseline),
        },
        comparison: {
          range: comparisonRange,
          records: mapRecords(comparison, query.unit),
          message: recordMessage(comparison),
        },
        differences: {
          heaviestSet:
            heaviest === null ? null : { value: heaviest, unit: query.unit },
          highestVolumeSet:
            volume === null
              ? null
              : { value: volume, unit: `${query.unit}*reps` },
          estimatedOneRepMax:
            epley === null ? null : { value: epley, unit: query.unit },
        },
      },
    };
  }

  private async select(
    userId: string,
    exerciseName: string,
    ranges: RecordRange[],
  ): Promise<RecordWinnerRow[]> {
    try {
      const exercise = await this.exercises.resolveName(exerciseName);
      if (!exercise)
        throw new ZodValidationException(
          new ZodError([
            {
              code: 'custom',
              path: ['exerciseName'],
              message: 'Unknown exercise',
            },
          ]),
        );
      return await this.records.selectWinners(userId, exercise.id, ranges);
    } catch (error) {
      if (isTransientDatabaseError(error))
        throw new ServiceUnavailableException();
      throw error;
    }
  }
}
