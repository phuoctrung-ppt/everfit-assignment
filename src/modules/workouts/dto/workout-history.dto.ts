import { createZodDto } from 'nestjs-zod';
import { HistoryQuerySchema } from '../../../schemas/history-query.schema';
import { HistoryResponseSchema } from '../../../schemas/history-response.schema';

export class HistoryQueryDto extends createZodDto(HistoryQuerySchema) {}
export class HistoryResponseDto extends createZodDto(HistoryResponseSchema) {}
