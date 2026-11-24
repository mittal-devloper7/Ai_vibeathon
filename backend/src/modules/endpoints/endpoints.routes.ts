import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { EndpointsController } from './endpoints.controller.js';
import { GeminiController } from '../gemini/gemini.controller.js';
import {
  createEndpointSchema,
  updateEndpointSchema,
  endpointIdParamSchema,
} from './endpoints.schema.js';
import { geminiRequestOptionsSchema } from '../gemini/gemini.schema.js';

export const endpointsRoutes = Router();

// Require API Key authentication on all endpoint management routes
endpointsRoutes.use(authMiddleware);

// POST /api/v1/endpoints
endpointsRoutes.post(
  '/',
  validate(createEndpointSchema, 'body'),
  EndpointsController.create
);

// GET /api/v1/endpoints
endpointsRoutes.get(
  '/',
  EndpointsController.list
);

// GET /api/v1/endpoints/:endpointId
endpointsRoutes.get(
  '/:endpointId',
  validate(endpointIdParamSchema, 'params'),
  EndpointsController.getById
);

// PATCH /api/v1/endpoints/:endpointId
endpointsRoutes.patch(
  '/:endpointId',
  validate(endpointIdParamSchema, 'params'),
  validate(updateEndpointSchema, 'body'),
  EndpointsController.update
);

// POST /api/v1/endpoints/:endpointId/rotate-secret
endpointsRoutes.post(
  '/:endpointId/rotate-secret',
  validate(endpointIdParamSchema, 'params'),
  EndpointsController.rotateSecret
);

// POST /api/v1/endpoints/:endpointId/health-report (Phase 5 Gemini Copilot)
endpointsRoutes.post(
  '/:endpointId/health-report',
  validate(endpointIdParamSchema, 'params'),
  validate(geminiRequestOptionsSchema, 'body'),
  GeminiController.generateEndpointHealthReport
);
