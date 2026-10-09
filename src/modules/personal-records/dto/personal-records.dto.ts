import { createZodDto } from 'nestjs-zod';
import {
  PersonalRecordQuerySchema,
  RecordComparisonQuerySchema,
} from '../../../schemas/personal-record-query.schema';
import {
  RecordResponseSchema,
  RecordComparisonResponseSchema,
} from '../../../schemas/personal-record-response.schema';
import { WorkoutUserParamsSchema } from '../../../schemas/workout-logging.schema';

export class RecordUserParamsDto extends createZodDto(
  WorkoutUserParamsSchema,
) {}
export class PersonalRecordQueryDto extends createZodDto(
  PersonalRecordQuerySchema,
) {}
export class RecordComparisonQueryDto extends createZodDto(
  RecordComparisonQuerySchema,
) {}
export class RecordResponseDto extends createZodDto(RecordResponseSchema) {}
export class RecordComparisonResponseDto extends createZodDto(
  RecordComparisonResponseSchema,
) {}
