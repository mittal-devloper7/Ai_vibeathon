import { Request, Response, NextFunction } from 'express';
import { DeliveriesService } from './deliveries.service.js';

export class DeliveriesController {
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.auth!.organizationId;
      const { status, endpoint_id, limit, offset } = req.query as {
        status?: string;
        endpoint_id?: string;
        limit?: string;
        offset?: string;
      };

      const deliveries = await DeliveriesService.list(orgId, {
        status,
        endpoint_id,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });

      res.status(200).json(deliveries);
    } catch (err) {
      next(err);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.auth!.organizationId;
      const { deliveryId } = req.params as { deliveryId: string };

      const delivery = await DeliveriesService.getById(orgId, deliveryId);
      res.status(200).json(delivery);
    } catch (err) {
      next(err);
    }
  }

  public static async replay(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.auth!.organizationId;
      const { deliveryId } = req.params as { deliveryId: string };
      const { reason = 'Manual replay initiated' } = req.body as { reason?: string };

      const replayResult = await DeliveriesService.replay(orgId, deliveryId, reason);
      res.status(202).json(replayResult);
    } catch (err) {
      next(err);
    }
  }
}
