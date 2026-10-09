import { z } from 'zod';
import { UtcDateSchema, WeightUnitSchema } from './common.schema';

export const EMPTY_RECORDS_MESSAGE =
  'No workout entries found for the requested exercise and range.';
const DecimalValueSchema = z.string().regex(/^(?:0|[1-9]\d*)\.\d{4}$/);
const SignedValueSchema = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{4}$/);
const VolumeUnitSchema = z.enum(['kg*reps', 'lb*reps']);
const achievement = {
  value: DecimalValueSchema,
  achievedAt: UtcDateSchema,
  entryId: z.uuid(),
  setPosition: z.number().int().min(1).max(100),
  reps: z.number().int().min(1).max(10000),
  weight: DecimalValueSchema,
  weightUnit: WeightUnitSchema,
};
export const MetricRecordSchema = z.strictObject({
  ...achievement,
  unit: z.union([WeightUnitSchema, VolumeUnitSchema]),
});
const WeightRecordSchema = z.strictObject({
  ...achievement,
  unit: WeightUnitSchema,
});
const VolumeRecordSchema = z.strictObject({
  ...achievement,
  unit: VolumeUnitSchema,
});
export const PersonalRecordsSchema = z.strictObject({
  heaviestSet: WeightRecordSchema.nullable(),
  highestVolumeSet: VolumeRecordSchema.nullable(),
  estimatedOneRepMax: WeightRecordSchema.nullable(),
});
export const RecordResponseSchema = z.strictObject({
  data: PersonalRecordsSchema,
  message: z.literal(EMPTY_RECORDS_MESSAGE).nullable(),
});
const PeriodSchema = z.strictObject({
  range: z.strictObject({ from: UtcDateSchema, to: UtcDateSchema }),
  records: PersonalRecordsSchema,
  message: z.literal(EMPTY_RECORDS_MESSAGE).nullable(),
});
const WeightDifferenceSchema = z.strictObject({
  value: SignedValueSchema,
  unit: WeightUnitSchema,
});
const VolumeDifferenceSchema = z.strictObject({
  value: SignedValueSchema,
  unit: VolumeUnitSchema,
});
export const RecordComparisonResponseSchema = z.strictObject({
  data: z.strictObject({
    baseline: PeriodSchema,
    comparison: PeriodSchema,
    differences: z.strictObject({
      heaviestSet: WeightDifferenceSchema.nullable(),
      highestVolumeSet: VolumeDifferenceSchema.nullable(),
      estimatedOneRepMax: WeightDifferenceSchema.nullable(),
    }),
  }),
});
export type MetricRecord = z.infer<typeof MetricRecordSchema>;
export type PersonalRecords = z.infer<typeof PersonalRecordsSchema>;
export type RecordResponse = z.infer<typeof RecordResponseSchema>;
export type RecordComparisonResponse = z.infer<
  typeof RecordComparisonResponseSchema
>;
