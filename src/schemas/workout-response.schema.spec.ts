import { WorkoutEntrySchema } from './workout-response.schema';

const id = '10000000-0000-4000-8000-000000000001';
const set = {
  id,
  position: 1,
  reps: 10,
  weight: '61.2350',
  unit: 'kg',
  originalWeight: '135.000000',
  originalUnit: 'lb',
};
const entry = {
  id,
  userId: 'coach_1',
  date: '2024-02-29T12:30:45.123Z',
  createdAt: '2024-02-29T12:30:45.123Z',
  exercise: { id, name: 'Bench Press', muscleGroups: ['chest', 'triceps'] },
  sets: [set],
};

describe('workout response contract', () => {
  it('retains original input and converted display strings', () => {
    expect(WorkoutEntrySchema.parse(entry)).toEqual(entry);
  });

  it.each([
    { ...set, weight: 61.235 },
    { ...set, weight: '61.235' },
    { ...set, originalWeight: '135.0000' },
    { ...set, weightKg: '61.23496995000000' },
    { ...set, position: 0 },
    { ...set, originalUnit: 'stone' },
  ])('rejects invalid output format and internal fields %#', (invalidSet) => {
    expect(
      WorkoutEntrySchema.safeParse({ ...entry, sets: [invalidSet] }).success,
    ).toBe(false);
  });

  it('rejects internal catalog fields', () => {
    expect(
      WorkoutEntrySchema.safeParse({
        ...entry,
        exercise: { ...entry.exercise, normalizedName: 'bench press' },
      }).success,
    ).toBe(false);
  });
});
