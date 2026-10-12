import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CSV_MAX_BYTES } from '../../schemas/csv-import.schema';
import {
  WorkoutImportParamsSchema,
  WorkoutImportResponseSchema,
} from '../../schemas/workout-import.schema';
import { WorkoutUserParamsDto } from '../workouts/dto/workout-logging.dto';
import { readIdempotencyKey } from '../workouts/idempotency-header';
import { WorkoutImportRepository } from './workout-import.repository';

class ImportParamsDto extends createZodDto(WorkoutImportParamsSchema) {}
class ImportResponseDto extends createZodDto(WorkoutImportResponseSchema) {}

@ApiTags('CSV imports')
@Controller('users/:userId/workout-entries')
export class WorkoutImportController {
  constructor(private readonly imports: WorkoutImportRepository) {}

  @Post('bulk/csv')
  @ApiOperation({
    summary:
      'Queue a CSV file for a separate import worker (32 MiB, 50,000 entries)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'User-scoped CSV import key. Same exact file reuses the job; changed bytes conflict.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: CSV_MAX_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  )
  @ZodResponse({ type: ImportResponseDto, status: 202 })
  async upload(
    @Param() params: WorkoutUserParamsDto,
    @Req() request: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const key = readIdempotencyKey(request);
    if (!file?.buffer?.length) throw new BadRequestException();
    return {
      data: await this.imports.enqueue(params.userId, key, file.buffer),
    };
  }

  @Get('imports/:importId')
  @ApiOperation({ summary: 'Read CSV import progress and validation errors' })
  @ZodResponse({ type: ImportResponseDto })
  async status(@Param() params: ImportParamsDto) {
    return { data: await this.imports.find(params.userId, params.importId) };
  }
}
