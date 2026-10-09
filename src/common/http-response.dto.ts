import { createZodDto } from 'nestjs-zod';
import {
  ErrorResponseSchema,
  HealthResponseSchema,
} from '../schemas/http-response.schema';

export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}
export class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
