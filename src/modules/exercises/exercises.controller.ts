import { Controller, Get } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { ErrorResponseDto } from '../../common/http-response.dto';
import { ExerciseListSchema } from '../../schemas/exercise.schema';
import { ExercisesRepository } from './exercises.repository';

class ExerciseListResponseDto extends createZodDto(ExerciseListSchema) {}

@ApiTags('Exercises')
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesRepository) {}

  @Get()
  @ApiOperation({ summary: 'List the exercise catalog with muscle groups' })
  @ApiOkResponse({ type: ExerciseListResponseDto })
  @ApiInternalServerErrorResponse({ type: ErrorResponseDto })
  async list(): Promise<ExerciseListResponseDto> {
    const exercises = await this.exercises.list();
    return {
      data: exercises.map(({ id, name, muscleGroups }) => ({
        id,
        name,
        muscleGroups,
      })),
    };
  }
}
