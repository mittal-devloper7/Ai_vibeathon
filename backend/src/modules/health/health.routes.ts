import { Router } from 'express';
import { HealthController } from './health.controller.js';

export const healthRoutes = Router();

healthRoutes.get('/live', HealthController.getLive);
healthRoutes.get('/ready', HealthController.getReady);
