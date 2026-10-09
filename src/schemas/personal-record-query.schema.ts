import { z } from 'zod';
import {
  ExerciseNameSchema,
  UtcDateSchema,
  WeightUnitSchema,
} from './common.schema';

const fields = {
  exerciseName: ExerciseNameSchema.describe(
    'Exact catalog exercise name, case-insensitive and trimmed.',
  ),
  unit: WeightUnitSchema.default('kg').describe(
    'Output weight unit; defaults to kg.',
  ),
};
export const PersonalRecordQuerySchema = z
  .strictObject({
    ...fields,
    from: UtcDateSchema.optional().describe(
      'Inclusive UTC start; omitted means unbounded.',
    ),
    to: UtcDateSchema.optional().describe(
      'Exclusive UTC end; omitted means unbounded.',
    ),
  })
  .refine(
    (query) =>
      !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to),
    {
      path: ['to'],
      message: 'End must be after start',
    },
  );
export const RecordComparisonQuerySchema = z
  .strictObject({
    ...fields,
    baselineFrom: UtcDateSchema.describe('Inclusive baseline UTC start.'),
    baselineTo: UtcDateSchema.describe('Exclusive baseline UTC end.'),
    comparisonFrom: UtcDateSchema.describe('Inclusive comparison UTC start.'),
    comparisonTo: UtcDateSchema.describe('Exclusive comparison UTC end.'),
  })
  .refine(
    (query) => Date.parse(query.baselineFrom) < Date.parse(query.baselineTo),
    {
      path: ['baselineTo'],
      message: 'End must be after start',
    },
  )
  .refine(
    (query) =>
      Date.parse(query.comparisonFrom) < Date.parse(query.comparisonTo),
    {
      path: ['comparisonTo'],
      message: 'End must be after start',
    },
  );
export type PersonalRecordQuery = z.infer<typeof PersonalRecordQuerySchema>;
export type RecordComparisonQuery = z.infer<typeof RecordComparisonQuerySchema>;
