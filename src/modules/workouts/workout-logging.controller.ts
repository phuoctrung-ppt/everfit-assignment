import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../common/http-response.dto';
import {
  BulkWorkoutRequestDto,
  BulkWorkoutResponseDto,
  CreateWorkoutRequestDto,
  SingleWorkoutResponseDto,
  WorkoutUserParamsDto,
} from './dto/workout-logging.dto';
import { readIdempotencyKey } from './idempotency-header';
import { WorkoutLoggingService } from './workout-logging.service';

@ApiTags('Workout logging')
@ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  description:
    'User-scoped retry key shared across both logging routes; 1–128 printable non-whitespace ASCII characters.',
  schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[!-~]+$' },
})
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiInternalServerErrorResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@ApiResponse({ status: 413, type: ErrorResponseDto })
@ApiResponse({ status: 415, type: ErrorResponseDto })
@Controller('users/:userId/workout-entries')
export class WorkoutLoggingController {
  constructor(private readonly logging: WorkoutLoggingService) {}

  @Post('bulk')
  @ApiOperation({ summary: 'Atomically log a batch of workout entries' })
  @ZodResponse({ type: BulkWorkoutResponseDto, status: 201 })
  async bulk(
    @Param() params: WorkoutUserParamsDto,
    @Body() body: BulkWorkoutRequestDto,
    @Req() request: Request,
  ) {
    const result = await this.logging.log(
      params.userId,
      readIdempotencyKey(request),
      'bulk',
      body,
    );
    return result.body;
  }

  @Post()
  @ApiOperation({ summary: 'Log one workout entry' })
  @ZodResponse({ type: SingleWorkoutResponseDto, status: 201 })
  async single(
    @Param() params: WorkoutUserParamsDto,
    @Body() body: CreateWorkoutRequestDto,
    @Req() request: Request,
  ) {
    const result = await this.logging.log(
      params.userId,
      readIdempotencyKey(request),
      'single',
      body,
    );
    return result.body;
  }
}
