import { HttpException } from '@nestjs/common';
import { json, type NextFunction, type Request, type Response } from 'express';

const parseJson = json({ limit: '1mb' });

export function jsonBodyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  parseJson(req, res, (error?: unknown) => {
    if (!error) return next();
    // Only trust statuses from the parser callback, never arbitrary application errors.
    const status =
      typeof error === 'object' && 'status' in error ? error.status : undefined;
    if (typeof status === 'number' && [400, 413, 415].includes(status)) {
      return next(new HttpException('Invalid request body', status));
    }
    next(error);
  });
}
