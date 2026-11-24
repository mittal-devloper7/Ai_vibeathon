import { Request, Response, NextFunction } from 'express';
import { GeminiService } from './gemini.service.js';

export class GeminiController {
  public static async diagnoseDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.auth!.organizationId;
      const { deliveryId } = req.params as { deliveryId: string };
      const { force_refresh } = (req.body || {}) as { force_refresh?: boolean };

      const diagnosis = await GeminiService.diagnoseDelivery(orgId, deliveryId, {
        forceRefresh: Boolean(force_refresh),
      });

      res.status(200).json(diagnosis);
    } catch (err) {
      next(err);
    }
  }

  public static async generateEndpointHealthReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.auth!.organizationId;
      const { endpointId } = req.params as { endpointId: string };
      const { force_refresh } = (req.body || {}) as { force_refresh?: boolean };

      const report = await GeminiService.generateEndpointHealthReport(orgId, endpointId, {
        forceRefresh: Boolean(force_refresh),
      });

      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  }
}
