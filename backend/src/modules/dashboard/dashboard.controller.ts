import { Request, Response, NextFunction } from 'express';
import { DashboardService } from './dashboard.service.js';

export class DashboardController {
  public static async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.auth!.organizationId;
      const metrics = await DashboardService.getMetrics(orgId);
      res.status(200).json(metrics);
    } catch (err) {
      next(err);
    }
  }
}
