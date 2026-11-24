import { pool, withTransaction } from '../../database/pool.js';
import { IdempotencyConflictError } from '../../shared/errors.js';

export interface IngestEventInput {
  organizationId: string;
  eventType: string;
  idempotencyKey?: string | null;
  payload: Record<string, unknown>;
  payloadSha256: string;
  headers?: Record<string, unknown>;
}

export interface IngestionResult {
  eventId: string;
  status: 'accepted';
  idempotentReplay: boolean;
  deliveriesCreated: number;
}

export interface EventRecord {
  id: string;
  organization_id: string;
  event_type: string;
  idempotency_key: string | null;
  payload: unknown;
  payload_sha256: string | null;
  status: string;
  created_at: Date;
  deliveries_count?: number;
}

export class EventsRepository {
  /**
   * Performs event ingestion, idempotency check, matching delivery creation,
   * and outbox event registration inside a single atomic PostgreSQL transaction.
   */
  public async ingestEvent(input: IngestEventInput): Promise<IngestionResult> {
    return withTransaction(async (client) => {
      // 1. Idempotency Check with Row Lock
      if (input.idempotencyKey) {
        const lockQuery = `
          SELECT id, status, payload_sha256, created_at
          FROM webhook_events
          WHERE organization_id = $1 AND idempotency_key = $2
          FOR UPDATE;
        `;
        const { rows: existingRows } = await client.query<{
          id: string;
          status: string;
          payload_sha256: string;
        }>(lockQuery, [input.organizationId, input.idempotencyKey]);

        if (existingRows.length > 0) {
          const existing = existingRows[0]!;
          if (existing.payload_sha256 !== input.payloadSha256) {
            throw new IdempotencyConflictError(
              'Idempotency key was previously used with a different payload'
            );
          }

          // Exact payload match: return existing event summary with 0 extra deliveries
          return {
            eventId: existing.id,
            status: 'accepted',
            idempotentReplay: true,
            deliveriesCreated: 0,
          };
        }
      }

      // 2. Insert into webhook_events
      const insertEventSql = `
        INSERT INTO webhook_events (
          organization_id, event_type, idempotency_key, payload, payload_sha256, headers, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        RETURNING id;
      `;

      const eventRes = await client.query<{ id: string }>(insertEventSql, [
        input.organizationId,
        input.eventType,
        input.idempotencyKey ?? null,
        JSON.stringify(input.payload),
        input.payloadSha256,
        JSON.stringify(input.headers ?? {}),
      ]);

      const eventId = eventRes.rows[0]!.id;

      // 3. Find matching active endpoints
      // Match exact event_type, catch-all '*', or wildcard pattern (e.g., 'payment.*')
      const matchSql = `
        SELECT DISTINCT e.id AS endpoint_id, e.policy, es.filter_rules
        FROM endpoints e
        JOIN event_subscriptions es 
          ON es.endpoint_id = e.id AND es.organization_id = e.organization_id
        WHERE e.organization_id = $1
          AND e.status = 'active'
          AND (
            es.event_type = $2 
            OR es.event_type = '*' 
            OR ($2 LIKE replace(es.event_type, '*', '%'))
          );
      `;

      const { rows: matchingEndpoints } = await client.query<{
        endpoint_id: string;
        policy: { max_attempts?: number };
        filter_rules: Record<string, unknown>;
      }>(matchSql, [input.organizationId, input.eventType]);

      let deliveriesCreated = 0;

      // 4. Create Deliveries & Outbox records for each matching endpoint
      for (const endpoint of matchingEndpoints) {
        // Evaluate filter_rules if present
        if (endpoint.filter_rules && Object.keys(endpoint.filter_rules).length > 0) {
          const passesFilter = Object.entries(endpoint.filter_rules).every(([key, expectedVal]) => {
            const dataVal = (input.payload as Record<string, unknown>)['data'];
            if (dataVal && typeof dataVal === 'object') {
              const actual = (dataVal as Record<string, unknown>)[key];
              if (typeof expectedVal === 'number' && typeof actual === 'number') {
                return actual >= expectedVal;
              }
              return actual === expectedVal;
            }
            return true;
          });

          if (!passesFilter) {
            continue;
          }
        }

        const maxAttempts = endpoint.policy?.max_attempts ?? 5;

        // Insert Delivery
        const deliveryRes = await client.query<{ id: string }>(
          `INSERT INTO deliveries (organization_id, webhook_event_id, endpoint_id, status, attempt_count, max_attempts)
           VALUES ($1, $2, $3, 'pending', 0, $4)
           RETURNING id;`,
          [input.organizationId, eventId, endpoint.endpoint_id, maxAttempts]
        );
        const deliveryId = deliveryRes.rows[0]!.id;

        // Insert Outbox Event with deduplication key
        const dedupeKey = `${deliveryId}:attempt_0`;
        const outboxPayload = {
          delivery_id: deliveryId,
          webhook_event_id: eventId,
          endpoint_id: endpoint.endpoint_id,
          organization_id: input.organizationId,
          event_type: input.eventType,
          attempt_number: 0,
        };

        await client.query(
          `INSERT INTO outbox_events (organization_id, event_name, payload, status, dedupe_key, delivery_id)
           VALUES ($1, 'webhook.delivery.dispatch', $2, 'pending', $3, $4)
           ON CONFLICT (organization_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;`,
          [input.organizationId, JSON.stringify(outboxPayload), dedupeKey, deliveryId]
        );

        deliveriesCreated++;
      }

      return {
        eventId,
        status: 'accepted',
        idempotentReplay: false,
        deliveriesCreated,
      };
    });
  }

  /**
   * Lists events scoped to organization with cursor pagination.
   */
  public async listEvents(
    organizationId: string,
    options: { limit: number; cursor?: string; eventType?: string }
  ): Promise<{ events: EventRecord[]; nextCursor: string | null }> {
    const params: unknown[] = [organizationId, options.limit + 1];
    let whereClauses = 'e.organization_id = $1';

    if (options.eventType) {
      params.push(options.eventType);
      whereClauses += ` AND e.event_type = $${params.length}`;
    }

    if (options.cursor) {
      params.push(options.cursor);
      whereClauses += ` AND e.created_at < (SELECT created_at FROM webhook_events WHERE id = $${params.length})`;
    }

    const query = `
      SELECT e.id, e.organization_id, e.event_type, e.idempotency_key, e.payload,
             e.payload_sha256, e.status, e.created_at,
             COUNT(d.id)::int AS deliveries_count
      FROM webhook_events e
      LEFT JOIN deliveries d ON d.webhook_event_id = e.id
      WHERE ${whereClauses}
      GROUP BY e.id
      ORDER BY e.created_at DESC
      LIMIT $2;
    `;

    const { rows } = await pool.query<EventRecord>(query, params);

    let nextCursor: string | null = null;
    if (rows.length > options.limit) {
      rows.pop(); // Remove extra peek row
      nextCursor = rows[rows.length - 1]?.id ?? null;
    }

    return { events: rows, nextCursor };
  }
}

export const eventsRepository = new EventsRepository();
