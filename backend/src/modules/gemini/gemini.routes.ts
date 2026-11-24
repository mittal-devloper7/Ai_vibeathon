import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { GeminiController } from './gemini.controller.js';
import {
  deliveryIdParamSchema,
  endpointIdParamSchema,
  geminiRequestOptionsSchema,
} from './gemini.schema.js';

export const geminiRoutes = Router();

// Require tenant authentication
geminiRoutes.use(authMiddleware);

// POST /deliveries/:deliveryId/diagnose
geminiRoutes.post(
  '/deliveries/:deliveryId/diagnose',
  validate(deliveryIdParamSchema, 'params'),
  validate(geminiRequestOptionsSchema, 'body'),
  GeminiController.diagnoseDelivery
);

// POST /endpoints/:endpointId/health-report
geminiRoutes.post(
  '/endpoints/:endpointId/health-report',
  validate(endpointIdParamSchema, 'params'),
  validate(geminiRequestOptionsSchema, 'body'),
  GeminiController.generateEndpointHealthReport
);
