import {
  formatOriginalWeight,
  formatWeight,
  normalizeWeight,
} from './weight-conversion';

describe('decimal weight conversion', () => {
  it('normalizes pounds exactly and formats either output unit', () => {
    expect(normalizeWeight(135, 'lb')).toBe('61.23496995000000');
    expect(formatWeight('61.23496995', 'kg')).toBe('61.2350');
    expect(formatWeight('61.23496995', 'lb')).toBe('135.0000');
  });

  it('preserves the smallest input and maximum weight exactly', () => {
    expect(normalizeWeight(0.000001, 'lb')).toBe('0.00000045359237');
    expect(normalizeWeight(999999.999999, 'lb')).toBe('453592.36999954640763');
    expect(normalizeWeight(1000000, 'kg')).toBe('1000000.00000000000000');
  });

  it.each(['kg', 'lb'] as const)('preserves zero in %s', (unit) => {
    expect(normalizeWeight(0, unit)).toBe('0.00000000000000');
    expect(formatWeight('0.00000000000000', unit)).toBe('0.0000');
  });

  it('rounds output half-up without first converting NUMERIC to Number', () => {
    expect(formatWeight('1.23445', 'kg')).toBe('1.2345');
    expect(formatWeight('1.23444999999999', 'kg')).toBe('1.2344');
    expect(formatWeight('999999.999949999999999', 'kg')).toBe('999999.9999');
  });

  it('returns the original input with six fractional digits', () => {
    expect(formatOriginalWeight(135)).toBe('135.000000');
    expect(formatOriginalWeight(0.000001)).toBe('0.000001');
    expect(formatOriginalWeight(0)).toBe('0.000000');
  });
});
