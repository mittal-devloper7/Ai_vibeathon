import { DeliveriesRepository, DeliverySummary, DeliveryDetail } from './deliveries.repository.js';
import { NotFoundError } from '../../shared/errors.js';

export class DeliveriesService {
  public static async list(
    orgId: string,
    filter: { status?: string; endpoint_id?: string; limit: number; offset: number }
  ): Promise<DeliverySummary[]> {
    return await DeliveriesRepository.list(orgId, filter);
  }

  public static async getById(orgId: string, deliveryId: string): Promise<DeliveryDetail> {
    const delivery = await DeliveriesRepository.findById(orgId, deliveryId);
    if (!delivery) {
      throw new NotFoundError('Delivery not found');
    }
    return delivery;
  }

  public static async replay(
    orgId: string,
    deliveryId: string,
    reason: string
  ): Promise<{
    delivery_id: string;
    replay_of_delivery_id: string;
    replay_number: number;
    status: string;
  }> {
    return await DeliveriesRepository.createReplay(orgId, deliveryId, reason);
  }
}
