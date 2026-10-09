export const WEIGHT_UNITS = Object.freeze({
  kg: '1',
  lb: '0.45359237',
});

export type WeightUnit = keyof typeof WEIGHT_UNITS;
