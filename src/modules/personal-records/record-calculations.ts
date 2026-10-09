import Decimal from 'decimal.js';
import type { RecordMetric, RecordWinnerRow } from './personal-records.types';

const RecordDecimal = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
});
export function setVolumeKg(weightKg: string, reps: number): string {
  return new RecordDecimal(weightKg).times(reps).toFixed();
}
export function estimatedOneRepMaxKg(weightKg: string, reps: number): string {
  return new RecordDecimal(weightKg)
    .times(30 + reps)
    .dividedBy(30)
    .toFixed();
}
function numerator(row: RecordWinnerRow): Decimal {
  const multiplier =
    row.metric === 'heaviestSet'
      ? 1
      : row.metric === 'highestVolumeSet'
        ? row.reps
        : 30 + row.reps;
  return new RecordDecimal(row.weight_kg).times(multiplier);
}
export function recordValueKg(row: RecordWinnerRow): string {
  if (row.metric === 'highestVolumeSet')
    return setVolumeKg(row.weight_kg, row.reps);
  if (row.metric === 'estimatedOneRepMax')
    return estimatedOneRepMaxKg(row.weight_kg, row.reps);
  return row.weight_kg;
}
export function recordDifferenceKg(
  metric: RecordMetric,
  baseline: RecordWinnerRow,
  comparison: RecordWinnerRow,
): string {
  // Subtract exact numerators before Epley's recurring division or display rounding.
  const difference = numerator(comparison).minus(numerator(baseline));
  return (
    metric === 'estimatedOneRepMax' ? difference.dividedBy(30) : difference
  ).toFixed();
}
