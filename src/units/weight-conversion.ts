import Decimal from 'decimal.js';
import { WEIGHT_UNITS, type WeightUnit } from './unit-registry';

// Isolate precision from other consumers of decimal.js and keep NUMERIC as strings.
const WeightDecimal = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
});

export function normalizeWeight(weight: number, unit: WeightUnit): string {
  return new WeightDecimal(weight.toString())
    .times(WEIGHT_UNITS[unit])
    .toFixed(14);
}

export function formatWeight(weightKg: string, unit: WeightUnit): string {
  return new WeightDecimal(weightKg).dividedBy(WEIGHT_UNITS[unit]).toFixed(4);
}

export function formatOriginalWeight(weight: number): string {
  return new WeightDecimal(weight.toString()).toFixed(6);
}
