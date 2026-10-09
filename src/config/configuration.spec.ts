import { validateEnvironment } from './configuration';

const valid = { DATABASE_URL: 'postgresql://localhost/workouts' };

describe('environment validation', () => {
  it('supplies bounded runtime defaults', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      PORT: 3000,
      DB_POOL_MAX: 10,
      DB_STATEMENT_TIMEOUT_MS: 5000,
      DB_LOCK_TIMEOUT_MS: 3000,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    });
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'https://localhost/workouts',
    'postgresql://localhost',
  ])('rejects invalid database URL %s', (DATABASE_URL) => {
    expect(() => validateEnvironment({ DATABASE_URL })).toThrow('DATABASE_URL');
  });

  it.each(['0', '-1', '3.5', '', 'NaN', '65536'])(
    'rejects invalid port %s',
    (PORT) => {
      expect(() => validateEnvironment({ ...valid, PORT })).toThrow('PORT');
    },
  );

  it('does not expose secret values in configuration errors', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'https://user:secret@host/db' }),
    ).toThrow('Invalid configuration: DATABASE_URL');
    try {
      validateEnvironment({ DATABASE_URL: 'https://user:secret@host/db' });
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });

  it.each(['DB_POOL_MAX', 'DB_STATEMENT_TIMEOUT_MS', 'DB_LOCK_TIMEOUT_MS'])(
    'rejects an unbounded %s',
    (key) => {
      expect(() => validateEnvironment({ ...valid, [key]: '0' })).toThrow(key);
    },
  );
});
