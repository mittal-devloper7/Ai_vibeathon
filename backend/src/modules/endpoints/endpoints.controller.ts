import { Request, Response, NextFunction } from 'express';
import { endpointsService } from './endpoints.service.js';

export class EndpointsController {
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.orgId!;
      const result = await endpointsService.createEndpoint(orgId, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.orgId!;
      const endpoints = await endpointsService.listEndpoints(orgId);
      res.status(200).json({ data: endpoints });
    } catch (err) {
      next(err);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.orgId!;
      const endpointId = String(req.params.endpointId);
      const endpoint = await endpointsService.getEndpoint(orgId, endpointId);
      res.status(200).json(endpoint);
    } catch (err) {
      next(err);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.orgId!;
      const endpointId = String(req.params.endpointId);
      const updated = await endpointsService.updateEndpoint(orgId, endpointId, req.body);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  }

  public static async rotateSecret(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.orgId!;
      const endpointId = String(req.params.endpointId);
      const result = await endpointsService.rotateSecret(orgId, endpointId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
