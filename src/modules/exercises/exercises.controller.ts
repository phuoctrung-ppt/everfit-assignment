import { Controller, Get } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiServiceUnavailableResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../common/http-response.dto';
import { ExerciseListResponseDto } from './dto/exercise-list-response.dto';
import { ExercisesService } from './exercises.service';

@ApiTags('Exercises')
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  @ApiOperation({
    summary: 'List the exercise catalog with muscle groups',
  })
  @ZodResponse({ type: ExerciseListResponseDto, status: 200 })
  @ApiInternalServerErrorResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  list(): Promise<ExerciseListResponseDto> {
    return this.exercises.list();
  }
}
