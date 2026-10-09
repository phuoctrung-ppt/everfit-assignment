/** Rational half-up rounding, independent of decimal.js and production helpers. */
export function display(
  numerator: bigint,
  denominator: bigint,
  unit: string,
): string {
  if (unit === 'lb') {
    numerator *= 100_000_000n;
    denominator *= 45_359_237n;
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute * 10_000n * 2n + denominator) / (2n * denominator);
  const digits = rounded.toString().padStart(5, '0');
  return `${negative && rounded !== 0n ? '-' : ''}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
