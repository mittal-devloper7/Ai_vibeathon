import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { DashboardController } from './dashboard.controller.js';

export const dashboardRoutes = Router();

// Tenant isolation via API Key authentication
dashboardRoutes.use(authMiddleware);

// GET /api/v1/dashboard/metrics
dashboardRoutes.get('/metrics', DashboardController.getMetrics);
