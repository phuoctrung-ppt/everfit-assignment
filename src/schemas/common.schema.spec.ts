import {
  ExerciseNameSchema,
  IdempotencyKeySchema,
  UserIdSchema,
  WeightUnitSchema,
} from './common.schema';

describe('shared request fields', () => {
  it('preserves exercise name whitespace and case for request fingerprints', () => {
    const value = '  Bench PRESS  ';
    expect(ExerciseNameSchema.parse(value)).toBe(value);
  });

  it.each(['\u0000', 'Bench\u0000Press', '\u0000Bench Press'])(
    'rejects NUL in exercise name %s before database lookup',
    (value) => {
      expect(ExerciseNameSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(['Coach_1-A', 'a'.repeat(128)])(
    'preserves valid user IDs %s',
    (value) => {
      expect(UserIdSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    '',
    'a'.repeat(129),
    'user name',
    'user/name',
    'user@example.com',
    null,
    123,
  ])('rejects invalid user ID %s', (value) => {
    expect(UserIdSchema.safeParse(value).success).toBe(false);
  });

  it('accepts printable non-whitespace ASCII idempotency keys without altering them', () => {
    const value = 'A-key_123:!~';
    expect(IdempotencyKeySchema.parse(value)).toBe(value);
    expect(IdempotencyKeySchema.safeParse('a'.repeat(128)).success).toBe(true);
  });

  it.each([
    '',
    'a'.repeat(129),
    ' has-space',
    'line\nbreak',
    'tab\tkey',
    '\u007f',
    'é',
    null,
    123,
  ])('rejects invalid idempotency key %s', (value) => {
    expect(IdempotencyKeySchema.safeParse(value).success).toBe(false);
  });

  it('takes supported units from the public registry', () => {
    expect(WeightUnitSchema.options).toEqual(['kg', 'lb']);
    expect(WeightUnitSchema.safeParse('KG').success).toBe(false);
  });
});
