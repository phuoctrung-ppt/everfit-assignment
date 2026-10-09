import { createZodDto } from 'nestjs-zod';
import {
  BulkWorkoutSchema,
  CreateWorkoutSchema,
} from '../../../schemas/workout.schema';
import {
  BulkWorkoutResponseSchema,
  SingleWorkoutResponseSchema,
  WorkoutUserParamsSchema,
} from '../../../schemas/workout-logging.schema';

export class CreateWorkoutRequestDto extends createZodDto(
  CreateWorkoutSchema,
) {}
export class BulkWorkoutRequestDto extends createZodDto(BulkWorkoutSchema) {}
export class WorkoutUserParamsDto extends createZodDto(
  WorkoutUserParamsSchema,
) {}
export class SingleWorkoutResponseDto extends createZodDto(
  SingleWorkoutResponseSchema,
) {}
export class BulkWorkoutResponseDto extends createZodDto(
  BulkWorkoutResponseSchema,
) {}
