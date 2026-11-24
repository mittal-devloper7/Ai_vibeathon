import { pool } from '../../database/pool.js';

export interface DashboardMetrics {
  deliveries_by_status: Record<string, number>;
  total_deliveries: number;
  success_rate: number;
  average_latency_ms: number;
  outbox_backlog: number;
  oldest_due_delivery_age_sec: number;
  circuit_breakers: {
    endpoint_id: string;
    endpoint_name: string;
    state: string;
    failure_count: number;
    open_until: string | null;
    last_failure_at: string | null;
  }[];
}

export class DashboardRepository {
  public static async getMetrics(orgId: string): Promise<DashboardMetrics> {
    // 1. Deliveries by status
    const statusSql = `
      SELECT status, COUNT(*)::int as count
      FROM deliveries
      WHERE organization_id = $1
      GROUP BY status;
    `;
    const statusRes = await pool.query<{ status: string; count: number }>(statusSql, [orgId]);

    const deliveriesByStatus: Record<string, number> = {
      pending: 0,
      in_progress: 0,
      processing: 0,
      delivered: 0,
      succeeded: 0,
      failed: 0,
      retry_scheduled: 0,
      exhausted: 0,
      dead_lettered: 0,
    };

    let totalDeliveries = 0;
    for (const row of statusRes.rows) {
      deliveriesByStatus[row.status] = row.count;
      totalDeliveries += row.count;
    }

    // Success rate calculation
    const succeeded = (deliveriesByStatus['succeeded'] || 0) + (deliveriesByStatus['delivered'] || 0);
    const terminalCompleted =
      succeeded +
      (deliveriesByStatus['failed'] || 0) +
      (deliveriesByStatus['exhausted'] || 0) +
      (deliveriesByStatus['dead_lettered'] || 0);

    const successRate =
      terminalCompleted > 0 ? parseFloat(((succeeded / terminalCompleted) * 100).toFixed(2)) : 0.0;

    // 2. Average latency across successful attempts
    const latencySql = `
      SELECT COALESCE(AVG(COALESCE(da.latency_ms, da.duration_ms)), 0)::float as avg_latency
      FROM delivery_attempts da
      JOIN deliveries d ON d.id = da.delivery_id
      WHERE d.organization_id = $1
        AND da.outcome = 'success';
    `;
    const latencyRes = await pool.query<{ avg_latency: number }>(latencySql, [orgId]);
    const averageLatencyMs = Math.round(latencyRes.rows[0]?.avg_latency || 0);

    // 3. Unpublished outbox backlog
    const outboxSql = `
      SELECT COUNT(*)::int as backlog
      FROM outbox_events
      WHERE organization_id = $1
        AND published_at IS NULL;
    `;
    const outboxRes = await pool.query<{ backlog: number }>(outboxSql, [orgId]);
    const outboxBacklog = outboxRes.rows[0]?.backlog || 0;

    // 4. Oldest due delivery age in seconds
    const oldestSql = `
      SELECT EXTRACT(EPOCH FROM (NOW() - created_at))::int as age_sec
      FROM deliveries
      WHERE organization_id = $1
        AND status IN ('pending', 'retry_scheduled')
      ORDER BY created_at ASC
      LIMIT 1;
    `;
    const oldestRes = await pool.query<{ age_sec: number }>(oldestSql, [orgId]);
    const oldestAgeSec = oldestRes.rows[0]?.age_sec || 0;

    // 5. Circuit breaker states
    const cbSql = `
      SELECT ecb.endpoint_id, e.name as endpoint_name, ecb.state,
             ecb.failure_count, ecb.open_until, ecb.last_failure_at
      FROM endpoint_circuit_breakers ecb
      JOIN endpoints e ON e.id = ecb.endpoint_id
      WHERE ecb.organization_id = $1
      ORDER BY ecb.updated_at DESC;
    `;
    const cbRes = await pool.query<{
      endpoint_id: string;
      endpoint_name: string;
      state: string;
      failure_count: number;
      open_until: string | null;
      last_failure_at: string | null;
    }>(cbSql, [orgId]);

    return {
      deliveries_by_status: deliveriesByStatus,
      total_deliveries: totalDeliveries,
      success_rate: successRate,
      average_latency_ms: averageLatencyMs,
      outbox_backlog: outboxBacklog,
      oldest_due_delivery_age_sec: oldestAgeSec,
      circuit_breakers: cbRes.rows,
    };
  }
}
