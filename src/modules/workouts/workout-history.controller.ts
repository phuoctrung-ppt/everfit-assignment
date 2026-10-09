import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../common/http-response.dto';
import { HistoryQueryDto, HistoryResponseDto } from './dto/workout-history.dto';
import { WorkoutUserParamsDto } from './dto/workout-logging.dto';
import { WorkoutHistoryService } from './workout-history.service';

@ApiTags('Workout history')
@Controller('users/:userId/workout-entries')
export class WorkoutHistoryController {
  constructor(private readonly history: WorkoutHistoryService) {}

  @Get()
  @ApiOperation({
    summary:
      'List filtered workout history, newest first with cursor pagination',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  @ZodResponse({ type: HistoryResponseDto, status: 200 })
  list(@Param() params: WorkoutUserParamsDto, @Query() query: HistoryQueryDto) {
    return this.history.list(params.userId, query);
  }
}
