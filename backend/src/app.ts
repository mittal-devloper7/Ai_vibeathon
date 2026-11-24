import crypto from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import { env } from './config/env.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { endpointsRoutes } from './modules/endpoints/endpoints.routes.js';
import { eventsRoutes } from './modules/events/events.routes.js';
import { deliveriesRoutes } from './modules/deliveries/deliveries.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { geminiRoutes } from './modules/gemini/gemini.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const DEFAULT_CORS_ORIGINS = [
  'https://ai-vibeathon.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function getAllowedCorsOrigins(
  corsOriginEnv: string = env.CORS_ORIGIN,
  frontendUrlEnv: string = env.FRONTEND_URL
): Set<string> {
  const origins = new Set<string>(DEFAULT_CORS_ORIGINS);
  const configuredSources = [corsOriginEnv, frontendUrlEnv];

  for (const raw of configuredSources) {
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const normalized = normalizeOrigin(part);
      if (normalized) {
        origins.add(normalized);
      }
    }
  }

  return origins;
}

export const app = express();

// CORS middleware for web frontend dashboard
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowedOrigins = getAllowedCorsOrigins();
  const rawOrigin = req.headers.origin;
  const requestOrigin = typeof rawOrigin === 'string' ? normalizeOrigin(rawOrigin) : undefined;

  if (allowedOrigins.has('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Idempotency-Key, X-Request-Id, Accept'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Bounded JSON body parser
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
});

// Health check routes (public)
app.use('/health', healthRoutes);

// V1 API Routes
app.use('/api/v1/endpoints', endpointsRoutes);
app.use('/api/v1/events', eventsRoutes);
app.use('/api/v1/deliveries', deliveriesRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1', geminiRoutes);

// Catch 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource does not exist',
      details: null,
    },
  });
});

// Centralized error handling middleware
app.use(errorHandler);
