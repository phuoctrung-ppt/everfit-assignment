import { createZodDto } from 'nestjs-zod';
import { ExerciseListSchema } from '../../../schemas/exercise.schema';

export class ExerciseListResponseDto extends createZodDto(ExerciseListSchema) {}
