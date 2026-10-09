import { ExerciseCatalogSchema } from './exercise-catalog.schema';

const exerciseId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const groupId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const catalog = (): {
  muscleGroups: [
    { id: string; name: string },
    ...{ id: string; name: string }[],
  ];
  exercises: [
    { id: string; name: string; muscleGroups: string[] },
    ...{ id: string; name: string; muscleGroups: string[] }[],
  ];
} => ({
  muscleGroups: [{ id: groupId, name: 'chest' }],
  exercises: [{ id: exerciseId, name: 'Bench Press', muscleGroups: ['chest'] }],
});

describe('exercise catalog validation', () => {
  it('canonicalizes valid UUIDs to PostgreSQL lowercase representation', () => {
    const input = catalog();
    input.exercises[0].id = exerciseId.toUpperCase();
    input.muscleGroups[0].id = groupId.toUpperCase();
    expect(ExerciseCatalogSchema.parse(input)).toEqual(catalog());
  });

  it.each(['exercises', 'muscleGroups'] as const)(
    'rejects case-variant duplicate UUIDs in %s',
    (key) => {
      const input = catalog();
      if (key === 'exercises') {
        input.exercises.push({
          id: exerciseId.toUpperCase(),
          name: 'Push Up',
          muscleGroups: [],
        });
      } else {
        input.muscleGroups.push({ id: groupId.toUpperCase(), name: 'triceps' });
      }
      const result = ExerciseCatalogSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: [key],
            message: 'Duplicate catalog values',
          }),
        );
      }
    },
  );

  it.each(['exercise', 'group', 'mapping'])(
    'rejects NUL in catalog %s names',
    (field) => {
      const input = catalog();
      if (field === 'exercise') input.exercises[0].name = 'Bench\u0000Press';
      if (field === 'group') {
        input.muscleGroups[0].name = 'chest\u0000';
        input.exercises[0].muscleGroups = ['chest\u0000'];
      }
      if (field === 'mapping')
        input.exercises[0].muscleGroups = ['chest\u0000'];
      expect(ExerciseCatalogSchema.safeParse(input).success).toBe(false);
    },
  );

  it('retains trimming and case-sensitive display names for seed input', () => {
    const input = catalog();
    input.exercises[0].name = '  Bench PRESS  ';
    input.muscleGroups[0].name = '  chest  ';
    input.exercises[0].muscleGroups = ['  chest  '];
    const parsed = ExerciseCatalogSchema.parse(input);
    expect(parsed.exercises[0]?.name).toBe('Bench PRESS');
    expect(parsed.muscleGroups[0]?.name).toBe('chest');
    expect(parsed.exercises[0]?.muscleGroups).toEqual(['chest']);
  });
});
