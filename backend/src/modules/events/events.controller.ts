import { Request, Response, NextFunction } from 'express';
import { eventsService } from './events.service.js';

export class EventsController {
  public static async ingest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.orgId!;
      const idempotencyKey = (req.headers['idempotency-key'] as string) || undefined;

      const result = await eventsService.ingestEvent(
        orgId,
        req.body,
        idempotencyKey,
        {
          'user-agent': req.headers['user-agent'],
          'content-type': req.headers['content-type'],
        }
      );

      res.status(202).json({
        event_id: result.eventId,
        status: result.status,
        idempotent_replay: result.idempotentReplay,
        deliveries_created: result.deliveriesCreated,
      });
    } catch (err) {
      next(err);
    }
  }

  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.orgId!;
      const limit = Number(req.query['limit']) || 20;
      const cursor = (req.query['cursor'] as string) || undefined;
      const eventType = (req.query['event_type'] as string) || undefined;

      const { events, nextCursor } = await eventsService.listEvents(orgId, {
        limit,
        cursor,
        event_type: eventType,
      });

      res.status(200).json({
        data: events,
        next_cursor: nextCursor,
      });
    } catch (err) {
      next(err);
    }
  }
}
