import { DashboardRepository, DashboardMetrics } from './dashboard.repository.js';

export class DashboardService {
  public static async getMetrics(orgId: string): Promise<DashboardMetrics> {
    return await DashboardRepository.getMetrics(orgId);
  }
}
