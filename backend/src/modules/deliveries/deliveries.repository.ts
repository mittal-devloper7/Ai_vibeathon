import { pool, withTransaction } from '../../database/pool.js';
import { NotFoundError, ConflictError } from '../../shared/errors.js';

export interface DeliverySummary {
  id: string;
  organization_id: string;
  webhook_event_id: string;
  endpoint_id: string;
  endpoint_name: string;
  endpoint_url: string;
  event_type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  replay_number: number;
  replay_of_delivery_id: string | null;
  last_http_status: number | null;
  last_failure_class: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAttemptDetail {
  id: string;
  attempt_number: number;
  status_code: number | null;
  outcome: string | null;
  failure_class: string | null;
  duration_ms: number | null;
  latency_ms: number | null;
  remote_ip: string | null;
  request_bytes: number | null;
  response_bytes: number | null;
  response_excerpt: string | null;
  response_headers: Record<string, unknown> | null;
  error_message: string | null;
  executed_at: string;
}

export interface DeadLetterInfo {
  id: string;
  reason: string;
  last_status_code: number | null;
  classified_at: string;
  resolved_at: string | null;
  replay_delivery_id: string | null;
  created_at: string;
}

export interface DeliveryDetail extends DeliverySummary {
  payload: Record<string, unknown>;
  attempts: DeliveryAttemptDetail[];
  dead_letter?: DeadLetterInfo | null;
}

export class DeliveriesRepository {
  public static async list(
    orgId: string,
    filter: { status?: string; endpoint_id?: string; limit: number; offset: number }
  ): Promise<DeliverySummary[]> {
    const params: unknown[] = [orgId];
    const whereClauses: string[] = ['d.organization_id = $1'];

    if (filter.status) {
      params.push(filter.status);
      whereClauses.push(`d.status = $${params.length}`);
    }

    if (filter.endpoint_id) {
      params.push(filter.endpoint_id);
      whereClauses.push(`d.endpoint_id = $${params.length}`);
    }

    params.push(filter.limit);
    const limitIdx = params.length;

    params.push(filter.offset);
    const offsetIdx = params.length;

    const sql = `
      SELECT d.id, d.organization_id, d.webhook_event_id, d.endpoint_id,
             e.name as endpoint_name, e.url as endpoint_url,
             we.event_type, d.status, d.attempt_count, d.max_attempts,
             d.replay_number, d.replay_of_delivery_id,
             d.last_http_status, d.last_failure_class, d.next_attempt_at,
             d.created_at, d.updated_at
      FROM deliveries d
      JOIN endpoints e ON e.id = d.endpoint_id
      JOIN webhook_events we ON we.id = d.webhook_event_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY d.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const res = await pool.query<DeliverySummary>(sql, params);
    return res.rows;
  }

  public static async findById(orgId: string, deliveryId: string): Promise<DeliveryDetail | null> {
    const deliverySql = `
      SELECT d.id, d.organization_id, d.webhook_event_id, d.endpoint_id,
             e.name as endpoint_name, e.url as endpoint_url,
             we.event_type, we.payload, d.status, d.attempt_count, d.max_attempts,
             d.replay_number, d.replay_of_delivery_id,
             d.last_http_status, d.last_failure_class, d.next_attempt_at,
             d.created_at, d.updated_at
      FROM deliveries d
      JOIN endpoints e ON e.id = d.endpoint_id
      JOIN webhook_events we ON we.id = d.webhook_event_id
      WHERE d.id = $1 AND d.organization_id = $2;
    `;

    const delRes = await pool.query<DeliverySummary & { payload: Record<string, unknown> }>(
      deliverySql,
      [deliveryId, orgId]
    );

    if (delRes.rows.length === 0) {
      return null;
    }

    const delivery = delRes.rows[0]!;

    // Fetch attempts
    const attemptsSql = `
      SELECT id, attempt_number, status_code, outcome, failure_class,
             duration_ms, latency_ms, remote_ip, request_bytes, response_bytes,
             response_excerpt, response_headers, error_message, executed_at
      FROM delivery_attempts
      WHERE delivery_id = $1
      ORDER BY attempt_number ASC;
    `;
    const attemptsRes = await pool.query<DeliveryAttemptDetail>(attemptsSql, [deliveryId]);

    // Fetch dead letter if present
    const dlqSql = `
      SELECT id, reason, last_status_code, classified_at, resolved_at,
             replay_delivery_id, created_at
      FROM dead_letter_entries
      WHERE delivery_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const dlqRes = await pool.query<DeadLetterInfo>(dlqSql, [deliveryId]);

    return {
      ...delivery,
      attempts: attemptsRes.rows,
      dead_letter: dlqRes.rows[0] || null,
    };
  }

  public static async createReplay(
    orgId: string,
    originalDeliveryId: string,
    reason: string
  ): Promise<{
    delivery_id: string;
    replay_of_delivery_id: string;
    replay_number: number;
    status: string;
  }> {
    return await withTransaction(async (client) => {
      // 1. Fetch original delivery with lock check
      const origSql = `
        SELECT id, organization_id, webhook_event_id, endpoint_id, status,
               max_attempts, replay_number
        FROM deliveries
        WHERE id = $1 AND organization_id = $2
        FOR UPDATE;
      `;
      const origRes = await client.query<{
        id: string;
        organization_id: string;
        webhook_event_id: string;
        endpoint_id: string;
        status: string;
        max_attempts: number;
        replay_number: number;
      }>(origSql, [originalDeliveryId, orgId]);

      if (origRes.rows.length === 0) {
        throw new NotFoundError('Delivery not found');
      }

      const original = origRes.rows[0]!;

      // 2. Reject replay if delivery is actively in flight
      if (original.status === 'processing') {
        throw new ConflictError('Cannot replay a delivery currently in processing state');
      }

      const nextReplayNumber = (original.replay_number ?? 0) + 1;

      // 3. Create new delivery row
      const insertDelSql = `
        INSERT INTO deliveries (
          organization_id, webhook_event_id, endpoint_id, status,
          attempt_count, max_attempts, replay_number, replay_of_delivery_id,
          created_at, updated_at
        ) VALUES ($1, $2, $3, 'pending', 0, $4, $5, $6, NOW(), NOW())
        RETURNING id, replay_of_delivery_id, replay_number, status;
      `;
      const newDelRes = await client.query<{
        id: string;
        replay_of_delivery_id: string;
        replay_number: number;
        status: string;
      }>(insertDelSql, [
        orgId,
        original.webhook_event_id,
        original.endpoint_id,
        original.max_attempts,
        nextReplayNumber,
        original.id,
      ]);
      const newDelivery = newDelRes.rows[0]!;

      // 4. Create outbox event in same transaction
      const insertOutboxSql = `
        INSERT INTO outbox_events (
          organization_id, event_name, payload, status, dedupe_key, delivery_id, created_at
        ) VALUES (
          $1, 'delivery.dispatch',
          jsonb_build_object('deliveryId', $2::text, 'reason', $3::text),
          'pending', $4, $2::uuid, NOW()
        );
      `;
      const dedupeKey = `replay__${newDelivery.id}__dispatch`;
      await client.query(insertOutboxSql, [
        orgId,
        newDelivery.id,
        reason,
        dedupeKey,
      ]);

      // 5. Update dead letter entries resolution if original was dead lettered
      await client.query(
        `UPDATE dead_letter_entries
         SET resolved_at = NOW(),
             replay_delivery_id = $1::uuid
         WHERE delivery_id = $2::uuid;`,
        [newDelivery.id, original.id]
      );

      return {
        delivery_id: newDelivery.id,
        replay_of_delivery_id: original.id,
        replay_number: newDelivery.replay_number,
        status: newDelivery.status,
      };
    });
  }
}
