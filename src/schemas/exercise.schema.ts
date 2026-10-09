import { z } from 'zod';

export const ExerciseSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  muscleGroups: z.array(z.string().min(1).max(80)),
});

export const ExerciseListSchema = z.strictObject({
  data: z.array(ExerciseSchema),
});

export type ExerciseDto = z.infer<typeof ExerciseSchema>;
export type ExerciseList = z.infer<typeof ExerciseListSchema>;
