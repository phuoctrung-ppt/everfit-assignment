import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';

const responses: Record<number, { code: string; message: string }> = {
  400: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
  404: { code: 'NOT_FOUND', message: 'Resource not found' },
  409: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key conflict' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 1 MiB' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported body encoding' },
  500: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const error = responses[status] ?? {
      code: 'HTTP_ERROR',
      message: 'Request failed',
    };
    const details =
      exception instanceof ZodValidationException
        ? (exception.getZodError() as ZodError).issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            // Zod messages can echo attacker-controlled unknown keys and values.
            message:
              issue.code === 'unrecognized_keys'
                ? 'Unknown field'
                : 'Invalid value',
          }))
        : [];
    this.logger[status >= 500 ? 'error' : 'warn'](
      { requestId: req.id, status, code: error.code },
      'Request failed',
    );
    res
      .status(status)
      .json({ error: { ...error, details }, requestId: req.id });
  }
}
