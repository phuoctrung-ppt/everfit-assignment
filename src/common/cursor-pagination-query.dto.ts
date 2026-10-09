import { createZodDto } from 'nestjs-zod';
import { CursorPaginationQuerySchema } from '../schemas/pagination.schema';

// Routes opt in explicitly with @Query() query: CursorPaginationQueryDto.
export class CursorPaginationQueryDto extends createZodDto(
  CursorPaginationQuerySchema,
) {}
