import {
  EMPTY_RECORDS_MESSAGE,
  type PersonalRecords,
} from '../../schemas/personal-record-response.schema';
import { formatWeight } from '../../units/weight-conversion';
import type { WeightUnit } from '../../units/unit-registry';
import { recordDifferenceKg, recordValueKg } from './record-calculations';
import type { RecordMetric, RecordWinnerRow } from './personal-records.types';

export function mapRecords(
  rows: RecordWinnerRow[],
  unit: WeightUnit,
): PersonalRecords {
  const records: PersonalRecords = {
    heaviestSet: null,
    highestVolumeSet: null,
    estimatedOneRepMax: null,
  };
  for (const row of rows) {
    const achievement = {
      value: formatWeight(recordValueKg(row), unit),
      achievedAt: row.achieved_at.toISOString(),
      entryId: row.entry_id,
      setPosition: row.set_position,
      reps: row.reps,
      weight: formatWeight(row.weight_kg, unit),
      weightUnit: unit,
    };
    if (row.metric === 'highestVolumeSet') {
      records.highestVolumeSet = { ...achievement, unit: `${unit}*reps` };
    } else {
      records[row.metric] = { ...achievement, unit };
    }
  }
  return records;
}
export function recordMessage(
  rows: RecordWinnerRow[],
): typeof EMPTY_RECORDS_MESSAGE | null {
  return rows.length ? null : EMPTY_RECORDS_MESSAGE;
}
export function differenceValue(
  metric: RecordMetric,
  baseline: RecordWinnerRow[],
  comparison: RecordWinnerRow[],
  unit: WeightUnit,
): string | null {
  const before = baseline.find((row) => row.metric === metric);
  const after = comparison.find((row) => row.metric === metric);
  if (!before || !after) return null;
  const value = formatWeight(recordDifferenceKg(metric, before, after), unit);
  return value === '-0.0000' ? '0.0000' : value;
}
