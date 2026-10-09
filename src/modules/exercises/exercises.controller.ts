import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiServiceUnavailableResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../common/http-response.dto';
import { ExerciseListResponseDto } from './dto/exercise-list-response.dto';
import { ExerciseListQueryDto } from './dto/exercise-list-query.dto';
import type { CursorPage } from '../../schemas/pagination.schema';
import type { ExerciseDto } from '../../schemas/exercise.schema';
import { ExercisesService } from './exercises.service';

@ApiTags('Exercises')
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  @ApiOperation({
    summary: 'List the exercise catalog using cursor pagination',
  })
  @ZodResponse({ type: ExerciseListResponseDto, status: 200 })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  list(@Query() query: ExerciseListQueryDto): Promise<CursorPage<ExerciseDto>> {
    return this.exercises.list(query);
  }
}
