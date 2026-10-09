import { z } from 'zod';
import { normalizeExerciseName } from '../modules/exercises/exercise.types';
import { ExerciseNameSchema } from './common.schema';

// PostgreSQL UUID identity ignores letter casing; normalize before duplicate checks.
const catalogId = z.uuid().transform((id) => id.toLowerCase());

const groupName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (name) => !name.includes('\u0000'),
    'Muscle group name must not contain NUL',
  )
  .refine(
    (name) => name === name.toLowerCase(),
    'Muscle group names must be lowercase',
  );

export const ExerciseCatalogSchema = z
  .strictObject({
    muscleGroups: z.array(z.strictObject({ id: catalogId, name: groupName })),
    exercises: z
      .array(
        z.strictObject({
          id: catalogId,
          name: ExerciseNameSchema.transform((name) => name.trim()),
          muscleGroups: z.array(groupName),
        }),
      )
      .min(1),
  })
  .superRefine((catalog, context) => {
    const checkDuplicates = (values: string[], path: (string | number)[]) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path,
          message: 'Duplicate catalog values',
        });
      }
    };
    checkDuplicates(
      catalog.muscleGroups.map((group) => group.id),
      ['muscleGroups'],
    );
    checkDuplicates(
      catalog.muscleGroups.map((group) => group.name),
      ['muscleGroups'],
    );
    checkDuplicates(
      catalog.exercises.map((exercise) => exercise.id),
      ['exercises'],
    );
    checkDuplicates(
      catalog.exercises.map((exercise) => normalizeExerciseName(exercise.name)),
      ['exercises'],
    );
    const groups = new Set(catalog.muscleGroups.map((group) => group.name));
    catalog.exercises.forEach((exercise, index) => {
      checkDuplicates(exercise.muscleGroups, [
        'exercises',
        index,
        'muscleGroups',
      ]);
      exercise.muscleGroups.forEach((group, groupIndex) => {
        if (!groups.has(group)) {
          context.addIssue({
            code: 'custom',
            path: ['exercises', index, 'muscleGroups', groupIndex],
            message: 'Unknown muscle group',
          });
        }
      });
    });
  });

export type ExerciseCatalog = z.infer<typeof ExerciseCatalogSchema>;
