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
import {
  PersonalRecordQueryDto,
  RecordComparisonQueryDto,
  RecordComparisonResponseDto,
  RecordResponseDto,
  RecordUserParamsDto,
} from './dto/personal-records.dto';
import { PersonalRecordsService } from './personal-records.service';

@ApiTags('Personal records')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiInternalServerErrorResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@Controller('users/:userId/personal-records')
export class PersonalRecordsController {
  constructor(private readonly records: PersonalRecordsService) {}

  @Get('compare')
  @ApiOperation({
    summary:
      'Compare exercise records across two UTC ranges; differences are comparison minus baseline',
  })
  @ZodResponse({ type: RecordComparisonResponseDto, status: 200 })
  compare(
    @Param() params: RecordUserParamsDto,
    @Query() query: RecordComparisonQueryDto,
  ) {
    return this.records.compare(params.userId, query);
  }

  @Get()
  @ApiOperation({
    summary:
      'Get three independent exercise records, optionally within a UTC range',
  })
  @ZodResponse({ type: RecordResponseDto, status: 200 })
  get(
    @Param() params: RecordUserParamsDto,
    @Query() query: PersonalRecordQueryDto,
  ) {
    return this.records.get(params.userId, query);
  }
}
