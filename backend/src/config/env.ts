import dotenv from 'dotenv';
import path from 'node:path';
import Joi from 'joi';

// Load .env from backend/ or project root
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
  DATABASE_CONNECTION_TIMEOUT_MS: number;
  DATABASE_SSL_REJECT_UNAUTHORIZED?: boolean;
  REDIS_URL: string;
  HMAC_MASTER_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  ALLOW_INSECURE_HTTP_ENDPOINTS: boolean;
  ALLOWED_INTERNAL_HOSTS: string;
  CORS_ORIGIN: string;
  FRONTEND_URL: string;
  QUEUE_NAME: string;
  WORKER_CONCURRENCY: number;
  GLOBAL_MAX_IN_FLIGHT: number;
  DEFAULT_ATTEMPT_TIMEOUT_MS: number;
}

const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: [/postgres/, /postgresql/] })
    .required()
    .messages({
      'any.required': 'DATABASE_URL is a required environment variable',
      'string.uri': 'DATABASE_URL must be a valid PostgreSQL connection URI',
      'string.uriCustomScheme': 'DATABASE_URL must be a valid PostgreSQL connection URI',
    }),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(20),
  DATABASE_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(1000).max(120000).default(30000),
  DATABASE_SSL_REJECT_UNAUTHORIZED: Joi.boolean().truthy('true').falsy('false').optional(),
  REDIS_URL: Joi.string()
    .uri({ scheme: [/redis/, /rediss/] })
    .required()
    .messages({
      'any.required': 'REDIS_URL is a required environment variable',
      'string.uri': 'REDIS_URL must be a valid Redis connection URI',
      'string.uriCustomScheme': 'REDIS_URL must be a valid Redis connection URI',
    }),
  HMAC_MASTER_KEY: Joi.string().min(32).required().messages({
    'any.required': 'HMAC_MASTER_KEY is required for webhook signing security',
    'string.min': 'HMAC_MASTER_KEY must be at least 32 characters long',
  }),
  GEMINI_API_KEY: Joi.string().allow('').default(''),
  GEMINI_MODEL: Joi.string().default('gemini-3.5-flash-lite'),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  ALLOW_INSECURE_HTTP_ENDPOINTS: Joi.boolean().truthy('true').falsy('false').default(false),
  ALLOWED_INTERNAL_HOSTS: Joi.string().allow('').default(''),
  CORS_ORIGIN: Joi.string().allow('').default(''),
  FRONTEND_URL: Joi.string().allow('').default(''),
  QUEUE_NAME: Joi.string().default('hookforge-deliveries'),
  WORKER_CONCURRENCY: Joi.number().integer().min(1).max(100).default(10),
  GLOBAL_MAX_IN_FLIGHT: Joi.number().integer().min(1).max(500).default(50),
  DEFAULT_ATTEMPT_TIMEOUT_MS: Joi.number().integer().min(500).max(60000).default(10000),
}).unknown(true);

export function validateEnv(rawEnv: Record<string, unknown> = process.env): EnvConfig {
  const { error, value } = envSchema.validate(rawEnv, { abortEarly: false, stripUnknown: false });
  if (error) {
    const errorDetails = error.details.map((d) => d.message).join('; ');
    throw new Error(`Environment validation failed: ${errorDetails}`);
  }
  return value as EnvConfig;
}

export const env: EnvConfig = validateEnv(process.env);
