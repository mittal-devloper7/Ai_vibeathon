import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const reqId = req.id || (req.headers['x-request-id'] as string);

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ reqId, err }, `Operational server error: ${err.message}`);
    } else {
      logger.warn({ reqId, err: { code: err.code, message: err.message, details: err.details } }, `Client error: ${err.message}`);
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
      },
    });
    return;
  }

  logger.error({ reqId, err }, 'Unhandled server exception');
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
      details: null,
    },
  });
}
