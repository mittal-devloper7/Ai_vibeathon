import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { DeliveriesController } from './deliveries.controller.js';
import { GeminiController } from '../gemini/gemini.controller.js';
import {
  listDeliveriesQuerySchema,
  deliveryIdParamSchema,
  replayDeliveryBodySchema,
} from './deliveries.schema.js';
import { geminiRequestOptionsSchema } from '../gemini/gemini.schema.js';

export const deliveriesRoutes = Router();

// Tenant isolation via API Key authentication
deliveriesRoutes.use(authMiddleware);

// GET /api/v1/deliveries
deliveriesRoutes.get(
  '/',
  validate(listDeliveriesQuerySchema, 'query'),
  DeliveriesController.list
);

// GET /api/v1/deliveries/:deliveryId
deliveriesRoutes.get(
  '/:deliveryId',
  validate(deliveryIdParamSchema, 'params'),
  DeliveriesController.getById
);

// POST /api/v1/deliveries/:deliveryId/replay
deliveriesRoutes.post(
  '/:deliveryId/replay',
  validate(deliveryIdParamSchema, 'params'),
  validate(replayDeliveryBodySchema, 'body'),
  DeliveriesController.replay
);

// POST /api/v1/deliveries/:deliveryId/diagnose (Phase 5 Gemini Incident Copilot)
deliveriesRoutes.post(
  '/:deliveryId/diagnose',
  validate(deliveryIdParamSchema, 'params'),
  validate(geminiRequestOptionsSchema, 'body'),
  GeminiController.diagnoseDelivery
);

