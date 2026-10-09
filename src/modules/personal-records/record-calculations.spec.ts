import { estimatedOneRepMaxKg, setVolumeKg } from './record-calculations';

describe('record calculations', () => {
  it('calculates exact volume and Epley values', () => {
    expect(setVolumeKg('60', 8)).toBe('480');
    expect(estimatedOneRepMaxKg('60', 8)).toBe('76');
    expect(estimatedOneRepMaxKg('90', 1)).toBe('93');
    expect(setVolumeKg('60', 20)).toBe('1200');
    expect(estimatedOneRepMaxKg('90', 8)).toBe('114');
  });
  it('preserves zero as a real result', () => {
    expect(setVolumeKg('0', 8)).toBe('0');
    expect(estimatedOneRepMaxKg('0', 8)).toBe('0');
  });
  it('retains decimal precision before display rounding', () => {
    expect(setVolumeKg('0.00000045359237', 10000)).toBe('0.0045359237');
    expect(estimatedOneRepMaxKg('70', 8)).toBe(
      '88.666666666666666666666666666666666666666666666667',
    );
  });
});
