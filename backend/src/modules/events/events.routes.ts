import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { EventsController } from './events.controller.js';
import { ingestEventSchema, listEventsQuerySchema } from './events.schema.js';

export const eventsRoutes = Router();

// Require API Key authentication on all event routes
eventsRoutes.use(authMiddleware);

// POST /api/v1/events
eventsRoutes.post(
  '/',
  validate(ingestEventSchema, 'body'),
  EventsController.ingest
);

// GET /api/v1/events
eventsRoutes.get(
  '/',
  validate(listEventsQuerySchema, 'query'),
  EventsController.list
);
