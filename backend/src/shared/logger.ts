import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers["webhook-signature"]',
      'headers.authorization',
      'headers["x-api-key"]',
      'secret',
      'apiKey',
      'key',
      'password',
      'token',
      '*.secret',
      '*.apiKey',
      '*.password',
      '*.token',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export function createRequestLogger(requestId: string) {
  return logger.child({ request_id: requestId });
}
