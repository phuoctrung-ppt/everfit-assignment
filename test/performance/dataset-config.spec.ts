import { datasetConfig } from './dataset-config';

describe('read benchmark database isolation', () => {
  const url =
    'postgres://test:placeholder@localhost/everfit_test_' + 'a'.repeat(32);

  it('requires an explicit database selection, never falling back to DATABASE_URL', () => {
    expect(() => datasetConfig([])).toThrow('Choose');
    expect(() =>
      datasetConfig(['--database-url', url, '--create-isolated']),
    ).toThrow('Choose');
  });

  it.each([
    'postgres://localhost/everfit',
    'postgres://localhost/everfit_test_other',
  ])(
    'rejects unsafe database namespace %s before connecting',
    (databaseUrl) => {
      expect(() => datasetConfig(['--database-url', databaseUrl])).toThrow(
        'Refusing',
      );
    },
  );

  it('accepts an explicit isolated target and preserves reproducible defaults', () => {
    expect(datasetConfig(['--database-url', url])).toMatchObject({
      databaseUrl: url,
      entries: 50000,
      setsPerEntry: 3,
      seed: 42,
    });
    expect(datasetConfig(['--create-isolated']).databaseUrl).toBeUndefined();
  });

  it.each([
    ['--entries', '49999'],
    ['--sets-per-entry', '2'],
    ['--seed', '-1'],
    ['--entries', '5e4'],
  ])('rejects unsupported dataset argument %s=%s', (flag, value) => {
    expect(() => datasetConfig(['--create-isolated', flag, value])).toThrow();
  });
});
