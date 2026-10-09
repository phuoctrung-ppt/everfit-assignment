import { BulkWorkoutSchema, CreateWorkoutSchema } from './workout.schema';

const set = { reps: 10, weight: 135, unit: 'lb' };
const workout = {
  date: '2024-02-29T12:30:45.123Z',
  exerciseName: 'Bench Press',
  sets: [set],
};

describe('workout request contracts', () => {
  it('preserves valid input values for idempotency fingerprinting', () => {
    const body = { ...workout, exerciseName: ' bench PRESS ' };
    expect(CreateWorkoutSchema.parse(body)).toEqual(body);
  });

  it.each([
    null,
    '2023-02-29T00:00:00Z',
    '2024-04-31T00:00:00Z',
    '2024-02-29',
    '2024-02-29T12:00:00',
    '2024-02-29T12:00:00+01:00',
    '2024-02-29T12:00:00+00:00',
    '2024-02-29T12:00:00.1234Z',
    '2024-02-29T24:00:00Z',
    '2024-02-29T12:00Z',
    '0000-01-01T00:00:00Z',
  ])('rejects invalid UTC date %s', (date) => {
    expect(CreateWorkoutSchema.safeParse({ ...workout, date }).success).toBe(
      false,
    );
  });

  it.each([
    '2024-02-29T12:00:00Z',
    '2024-02-29T12:00:00.1Z',
    '2024-02-29T12:00:00.12Z',
    '2024-02-29T12:00:00.123Z',
  ])('accepts UTC timestamps with up to milliseconds %s', (date) => {
    expect(CreateWorkoutSchema.safeParse({ ...workout, date }).success).toBe(
      true,
    );
  });

  it.each([0, -1, 1.5, 10001, '10', null])(
    'rejects invalid reps %s',
    (reps) => {
      expect(
        CreateWorkoutSchema.safeParse({ ...workout, sets: [{ ...set, reps }] })
          .success,
      ).toBe(false);
    },
  );

  it.each([
    -1,
    1000000.000001,
    0.0000001,
    0.1234567,
    NaN,
    Infinity,
    -Infinity,
    '135',
    null,
  ])('rejects invalid weight %s', (weight) => {
    expect(
      CreateWorkoutSchema.safeParse({ ...workout, sets: [{ ...set, weight }] })
        .success,
    ).toBe(false);
  });

  it.each([0, 0.000001, 1.123456, 999999.999999, 1000000])(
    'accepts bounded six-decimal weight %s',
    (weight) => {
      expect(
        CreateWorkoutSchema.safeParse({
          ...workout,
          sets: [{ ...set, weight }],
        }).success,
      ).toBe(true);
    },
  );

  it.each(['', '   ', 'a'.repeat(201), null])(
    'rejects invalid exercise name %s',
    (exerciseName) => {
      expect(
        CreateWorkoutSchema.safeParse({ ...workout, exerciseName }).success,
      ).toBe(false);
    },
  );

  it.each([
    { ...workout, userId: 'injected' },
    { ...workout, sets: [{ ...set, unknown: true }] },
    { ...workout, sets: [{ ...set, unit: 'stone' }] },
    { ...workout, sets: [] },
    { ...workout, sets: Array.from({ length: 101 }, () => set) },
    { ...workout, sets: null },
  ])('rejects invalid nested shape %#', (body) => {
    expect(CreateWorkoutSchema.safeParse(body).success).toBe(false);
  });

  it('reports the exact bulk entry and set indexes', () => {
    const result = BulkWorkoutSchema.safeParse({
      entries: [
        workout,
        {
          ...workout,
          sets: [set, { ...set, weight: -1 }],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        'entries',
        1,
        'sets',
        1,
        'weight',
      ]);
    }
  });

  it.each([
    { entries: [] },
    { entries: [workout], extra: true },
    { entries: Array.from({ length: 101 }, () => workout) },
    {
      entries: Array.from({ length: 11 }, () => ({
        ...workout,
        sets: Array.from({ length: 100 }, () => set),
      })),
    },
  ])('rejects invalid bulk limits and shape %#', (body) => {
    expect(BulkWorkoutSchema.safeParse(body).success).toBe(false);
  });

  it('accepts exactly 100 entries and 1000 total sets', () => {
    const entries = Array.from({ length: 100 }, () => ({
      ...workout,
      sets: Array.from({ length: 10 }, () => set),
    }));
    expect(BulkWorkoutSchema.safeParse({ entries }).success).toBe(true);
  });
});
