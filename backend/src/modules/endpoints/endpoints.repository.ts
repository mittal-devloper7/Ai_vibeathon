import { pool, withTransaction } from '../../database/pool.js';

export interface EndpointRecord {
  id: string;
  organization_id: string;
  name: string;
  url: string;
  description: string | null;
  status: 'active' | 'disabled' | 'failing';
  rate_limit_per_minute: number;
  policy: {
    max_attempts: number;
    attempt_timeout_ms: number;
    max_in_flight: number;
  };
  signing_key_id: string;
  created_at: Date;
  updated_at: Date;
  circuit_breaker_state?: string;
  subscriptions?: string[];
}

export interface CreateEndpointDto {
  name: string;
  url: string;
  description?: string | null;
  subscriptions: string[];
  rate_limit_per_minute?: number;
  policy?: {
    max_attempts?: number;
    attempt_timeout_ms?: number;
    max_in_flight?: number;
  };
}

export interface UpdateEndpointDto {
  name?: string;
  url?: string;
  description?: string | null;
  status?: 'active' | 'disabled';
  subscriptions?: string[];
  rate_limit_per_minute?: number;
  policy?: {
    max_attempts?: number;
    attempt_timeout_ms?: number;
    max_in_flight?: number;
  };
}

export class EndpointsRepository {
  /**
   * Inserts an endpoint, default circuit breaker, and subscriptions inside a single transaction.
   */
  public async createEndpoint(
    organizationId: string,
    dto: CreateEndpointDto,
    encryptedSecret: string,
    signingKeyId: string
  ): Promise<EndpointRecord> {
    return withTransaction(async (client) => {
      // 1. Insert endpoint
      const insertEndpointSql = `
        INSERT INTO endpoints (
          organization_id, name, url, description, secret, signing_key_id,
          status, rate_limit_per_minute, policy
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
        RETURNING id, organization_id, name, url, description, status,
                  rate_limit_per_minute, policy, signing_key_id, created_at, updated_at;
      `;

      const rateLimit = dto.rate_limit_per_minute || 600;
      const policy = {
        max_attempts: dto.policy?.max_attempts ?? 5,
        attempt_timeout_ms: dto.policy?.attempt_timeout_ms ?? 10000,
        max_in_flight: dto.policy?.max_in_flight ?? 10,
      };

      const endpointRes = await client.query<EndpointRecord>(insertEndpointSql, [
        organizationId,
        dto.name,
        dto.url,
        dto.description ?? null,
        encryptedSecret,
        signingKeyId,
        rateLimit,
        JSON.stringify(policy),
      ]);

      const endpoint = endpointRes.rows[0]!;

      // 2. Initialize circuit breaker
      await client.query(
        `INSERT INTO endpoint_circuit_breakers (endpoint_id, organization_id, state)
         VALUES ($1, $2, 'closed')
         ON CONFLICT (endpoint_id) DO NOTHING;`,
        [endpoint.id, organizationId]
      );

      // 3. Insert subscriptions
      for (const eventType of dto.subscriptions) {
        await client.query(
          `INSERT INTO event_subscriptions (organization_id, endpoint_id, event_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (endpoint_id, event_type) DO NOTHING;`,
          [organizationId, endpoint.id, eventType]
        );
      }

      endpoint.circuit_breaker_state = 'closed';
      endpoint.subscriptions = dto.subscriptions;

      return endpoint;
    });
  }

  /**
   * Finds an endpoint by ID scoped strictly to the authenticated organization.
   */
  public async findById(organizationId: string, endpointId: string): Promise<EndpointRecord | null> {
    const query = `
      SELECT e.id, e.organization_id, e.name, e.url, e.description, e.status,
             e.rate_limit_per_minute, e.policy, e.signing_key_id, e.created_at, e.updated_at,
             COALESCE(cb.state, 'closed') AS circuit_breaker_state,
             COALESCE(
               array_agg(es.event_type) FILTER (WHERE es.event_type IS NOT NULL),
               '{}'
             ) AS subscriptions
      FROM endpoints e
      LEFT JOIN endpoint_circuit_breakers cb 
        ON cb.endpoint_id = e.id AND cb.organization_id = e.organization_id
      LEFT JOIN event_subscriptions es 
        ON es.endpoint_id = e.id AND es.organization_id = e.organization_id
      WHERE e.id = $1 AND e.organization_id = $2
      GROUP BY e.id, cb.state;
    `;

    const { rows } = await pool.query<EndpointRecord>(query, [endpointId, organizationId]);
    return rows[0] || null;
  }

  /**
   * Lists all endpoints for an organization with circuit breaker status and subscriptions.
   */
  public async listByOrg(organizationId: string): Promise<EndpointRecord[]> {
    const query = `
      SELECT e.id, e.organization_id, e.name, e.url, e.description, e.status,
             e.rate_limit_per_minute, e.policy, e.signing_key_id, e.created_at, e.updated_at,
             COALESCE(cb.state, 'closed') AS circuit_breaker_state,
             COALESCE(
               array_agg(es.event_type) FILTER (WHERE es.event_type IS NOT NULL),
               '{}'
             ) AS subscriptions
      FROM endpoints e
      LEFT JOIN endpoint_circuit_breakers cb 
        ON cb.endpoint_id = e.id AND cb.organization_id = e.organization_id
      LEFT JOIN event_subscriptions es 
        ON es.endpoint_id = e.id AND es.organization_id = e.organization_id
      WHERE e.organization_id = $1
      GROUP BY e.id, cb.state
      ORDER BY e.created_at DESC;
    `;

    const { rows } = await pool.query<EndpointRecord>(query, [organizationId]);
    return rows;
  }

  /**
   * Updates an endpoint and its subscriptions atomically.
   */
  public async updateEndpoint(
    organizationId: string,
    endpointId: string,
    dto: UpdateEndpointDto
  ): Promise<EndpointRecord | null> {
    return withTransaction(async (client) => {
      // Build dynamic UPDATE query
      const setClauses: string[] = [];
      const values: unknown[] = [endpointId, organizationId];
      let paramIdx = 3;

      if (dto.name !== undefined) {
        setClauses.push(`name = $${paramIdx++}`);
        values.push(dto.name);
      }
      if (dto.url !== undefined) {
        setClauses.push(`url = $${paramIdx++}`);
        values.push(dto.url);
      }
      if (dto.description !== undefined) {
        setClauses.push(`description = $${paramIdx++}`);
        values.push(dto.description);
      }
      if (dto.status !== undefined) {
        setClauses.push(`status = $${paramIdx++}`);
        values.push(dto.status);
      }
      if (dto.rate_limit_per_minute !== undefined) {
        setClauses.push(`rate_limit_per_minute = $${paramIdx++}`);
        values.push(dto.rate_limit_per_minute);
      }
      if (dto.policy !== undefined) {
        setClauses.push(`policy = $${paramIdx++}`);
        values.push(JSON.stringify(dto.policy));
      }

      setClauses.push(`updated_at = NOW()`);

      const updateSql = `
        UPDATE endpoints
        SET ${setClauses.join(', ')}
        WHERE id = $1 AND organization_id = $2
        RETURNING id;
      `;

      const updateRes = await client.query(updateSql, values);
      if (updateRes.rows.length === 0) {
        return null;
      }

      // If subscriptions provided, replace them
      if (dto.subscriptions !== undefined) {
        await client.query(
          `DELETE FROM event_subscriptions WHERE endpoint_id = $1 AND organization_id = $2;`,
          [endpointId, organizationId]
        );

        for (const eventType of dto.subscriptions) {
          await client.query(
            `INSERT INTO event_subscriptions (organization_id, endpoint_id, event_type)
             VALUES ($1, $2, $3);`,
            [organizationId, endpointId, eventType]
          );
        }
      }

      // Re-fetch the updated endpoint record
      const selectSql = `
        SELECT e.id, e.organization_id, e.name, e.url, e.description, e.status,
               e.rate_limit_per_minute, e.policy, e.signing_key_id, e.created_at, e.updated_at,
               COALESCE(cb.state, 'closed') AS circuit_breaker_state,
               COALESCE(
                 array_agg(es.event_type) FILTER (WHERE es.event_type IS NOT NULL),
                 '{}'
               ) AS subscriptions
        FROM endpoints e
        LEFT JOIN endpoint_circuit_breakers cb 
          ON cb.endpoint_id = e.id AND cb.organization_id = e.organization_id
        LEFT JOIN event_subscriptions es 
          ON es.endpoint_id = e.id AND es.organization_id = e.organization_id
        WHERE e.id = $1 AND e.organization_id = $2
        GROUP BY e.id, cb.state;
      `;

      const res = await client.query<EndpointRecord>(selectSql, [endpointId, organizationId]);
      return res.rows[0] || null;
    });
  }

  /**
   * Updates an endpoint's encrypted signing secret and key ID.
   */
  public async rotateSecret(
    organizationId: string,
    endpointId: string,
    encryptedSecret: string,
    signingKeyId: string
  ): Promise<boolean> {
    const query = `
      UPDATE endpoints
      SET secret = $1, signing_key_id = $2, updated_at = NOW()
      WHERE id = $3 AND organization_id = $4
      RETURNING id;
    `;

    const { rows } = await pool.query(query, [
      encryptedSecret,
      signingKeyId,
      endpointId,
      organizationId,
    ]);

    return rows.length > 0;
  }
}

export const endpointsRepository = new EndpointsRepository();
