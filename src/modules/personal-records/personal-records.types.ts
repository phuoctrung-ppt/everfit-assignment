export type RecordMetric =
  'heaviestSet' | 'highestVolumeSet' | 'estimatedOneRepMax';
export type RecordRange = {
  period: 'current' | 'baseline' | 'comparison';
  from?: string;
  to?: string;
};
export type RecordWinnerRow = {
  period: RecordRange['period'];
  metric: RecordMetric;
  canonical_value: string;
  weight_kg: string;
  reps: number;
  achieved_at: Date;
  entry_id: string;
  set_position: number;
};
export type {
  MetricRecord,
  PersonalRecords,
  RecordResponse,
  RecordComparisonResponse,
} from '../../schemas/personal-record-response.schema';
