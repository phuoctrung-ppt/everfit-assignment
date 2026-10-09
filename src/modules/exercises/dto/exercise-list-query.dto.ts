import { createZodDto } from 'nestjs-zod';
import { ExerciseListQuerySchema } from '../../../schemas/exercise-query.schema';

export class ExerciseListQueryDto extends createZodDto(
  ExerciseListQuerySchema,
) {}
