import { getSharedRedisClient } from '../../database/redis.js';
import { pool } from '../../database/pool.js';
import { logger } from '../../shared/logger.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  failureThreshold?: number; // consecutive failures to trip
  cooldownPeriodMs?: number; // how long to stay open before half_open
  halfOpenProbeTimeoutMs?: number; // lease time for half-open probe
}

export interface CanExecuteResult {
  allowed: boolean;
  state: CircuitState;
  reason?: string;
  openUntil?: Date;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_PERIOD_MS = 30000; // 30s
const DEFAULT_PROBE_TIMEOUT_MS = 10000; // 10s

export class CircuitBreaker {
  private config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
      cooldownPeriodMs: config.cooldownPeriodMs ?? DEFAULT_COOLDOWN_PERIOD_MS,
      halfOpenProbeTimeoutMs: config.halfOpenProbeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    };
  }

  private stateKey(endpointId: string): string {
    return `cb:${endpointId}:state`;
  }

  private openUntilKey(endpointId: string): string {
    return `cb:${endpointId}:open_until`;
  }

  private failuresKey(endpointId: string): string {
    return `cb:${endpointId}:failures`;
  }

  private probeKey(endpointId: string): string {
    return `cb:${endpointId}:probe`;
  }

  /**
   * Checks whether delivery execution to this endpoint is currently permitted.
   */
  public async canExecute(endpointId: string): Promise<CanExecuteResult> {
    const redis = getSharedRedisClient();
    const now = Date.now();

    // 1. Read state and open_until from Redis
    const [rawState, rawOpenUntil] = await Promise.all([
      redis.get(this.stateKey(endpointId)),
      redis.get(this.openUntilKey(endpointId)),
    ]);

    let state: CircuitState = (rawState as CircuitState) || 'closed';
    const openUntilMs = rawOpenUntil ? parseInt(rawOpenUntil, 10) : 0;

    // 2. Evaluate State Transitions
    if (state === 'open') {
      if (now < openUntilMs) {
        // Still in open cooldown
        return {
          allowed: false,
          state: 'open',
          reason: 'CIRCUIT_OPEN',
          openUntil: new Date(openUntilMs),
        };
      }

      // Cooldown expired: transition to half_open
      state = 'half_open';
      await redis.set(this.stateKey(endpointId), 'half_open');
      logger.info({ endpointId }, 'Circuit breaker transitioned from OPEN to HALF_OPEN');
    }

    if (state === 'half_open') {
      // Exactly one worker can probe in half_open
      const probeWorkerId = `probe-${now}`;
      const acquired = await redis.set(
        this.probeKey(endpointId),
        probeWorkerId,
        'PX',
        this.config.halfOpenProbeTimeoutMs,
        'NX'
      );

      if (acquired === 'OK') {
        return {
          allowed: true,
          state: 'half_open',
        };
      } else {
        // Another probe is currently in flight
        return {
          allowed: false,
          state: 'half_open',
          reason: 'CIRCUIT_HALF_OPEN_PROBE_IN_FLIGHT',
          openUntil: new Date(now + 2000), // defer briefly
        };
      }
    }

    // Closed: allowed
    return {
      allowed: true,
      state: 'closed',
    };
  }

  /**
   * Records a successful delivery. Resets failures and closes the circuit.
   */
  public async recordSuccess(endpointId: string, orgId?: string): Promise<void> {
    const redis = getSharedRedisClient();
    const currentState = await redis.get(this.stateKey(endpointId));

    await Promise.all([
      redis.set(this.stateKey(endpointId), 'closed'),
      redis.del(this.openUntilKey(endpointId)),
      redis.del(this.failuresKey(endpointId)),
      redis.del(this.probeKey(endpointId)),
    ]);

    if (currentState && currentState !== 'closed') {
      logger.info({ endpointId, previousState: currentState }, 'Circuit breaker RESET to CLOSED on success');
    }

    // Mirror to PostgreSQL if organizationId is known
    if (orgId) {
      await this.mirrorToDb(endpointId, orgId, 'closed', 0, null);
    }
  }

  /**
   * Records a failed delivery attempt.
   * Client errors (4xx) do not trip the circuit breaker.
   */
  public async recordFailure(
    endpointId: string,
    orgId: string,
    failureClass: string,
    httpStatus?: number | null
  ): Promise<{ tripped: boolean; openUntil?: Date }> {
    // Client errors (e.g. 400 Bad Request, 401, 404, 422) must NOT trip the circuit breaker
    if (failureClass === 'http_4xx_terminal' || (httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429)) {
      return { tripped: false };
    }

    const redis = getSharedRedisClient();
    const now = Date.now();
    const state = ((await redis.get(this.stateKey(endpointId))) as CircuitState) || 'closed';

    // If already half_open, probe failed: immediately reopen with full cooldown
    if (state === 'half_open') {
      const openUntilMs = now + this.config.cooldownPeriodMs;
      await Promise.all([
        redis.set(this.stateKey(endpointId), 'open'),
        redis.set(this.openUntilKey(endpointId), String(openUntilMs)),
        redis.del(this.probeKey(endpointId)),
      ]);

      logger.warn({ endpointId, openUntilMs }, 'Circuit breaker probe failed in HALF_OPEN: TRIPPED to OPEN');
      await this.mirrorToDb(endpointId, orgId, 'open', this.config.failureThreshold, new Date(openUntilMs));
      return { tripped: true, openUntil: new Date(openUntilMs) };
    }

    // Increment consecutive failures in Redis
    const failures = await redis.incr(this.failuresKey(endpointId));

    if (failures >= this.config.failureThreshold) {
      const openUntilMs = now + this.config.cooldownPeriodMs;
      await Promise.all([
        redis.set(this.stateKey(endpointId), 'open'),
        redis.set(this.openUntilKey(endpointId), String(openUntilMs)),
      ]);

      logger.warn(
        { endpointId, failures, openUntilMs },
        'Circuit breaker threshold reached: TRIPPED from CLOSED to OPEN'
      );

      await this.mirrorToDb(endpointId, orgId, 'open', failures, new Date(openUntilMs));
      return { tripped: true, openUntil: new Date(openUntilMs) };
    }

    // Update failures in DB without tripping
    await this.mirrorToDb(endpointId, orgId, 'closed', failures, null);
    return { tripped: false };
  }

  /**
   * Durably mirrors circuit breaker state to PostgreSQL `endpoint_circuit_breakers`.
   */
  public async mirrorToDb(
    endpointId: string,
    orgId: string,
    state: CircuitState,
    failures: number,
    openUntil: Date | null
  ): Promise<void> {
    try {
      const sql = `
        INSERT INTO endpoint_circuit_breakers (
          endpoint_id,
          organization_id,
          state,
          failure_count,
          consecutive_failures,
          open_until,
          last_failure_at,
          last_state_change_at,
          updated_at
        )
        SELECT $1::uuid, $2::uuid, $3, $4, $4, $5, NOW(), NOW(), NOW()
        WHERE EXISTS (SELECT 1 FROM endpoints WHERE id = $1::uuid AND organization_id = $2::uuid)
        ON CONFLICT (endpoint_id) DO UPDATE SET
          state = EXCLUDED.state,
          failure_count = EXCLUDED.failure_count,
          consecutive_failures = EXCLUDED.consecutive_failures,
          open_until = EXCLUDED.open_until,
          last_failure_at = CASE WHEN EXCLUDED.state = 'open' OR EXCLUDED.failure_count > 0 THEN NOW() ELSE endpoint_circuit_breakers.last_failure_at END,
          last_state_change_at = CASE WHEN endpoint_circuit_breakers.state <> EXCLUDED.state THEN NOW() ELSE endpoint_circuit_breakers.last_state_change_at END,
          updated_at = NOW();
      `;

      await pool.query(sql, [endpointId, orgId, state, failures, openUntil]);
    } catch (err: unknown) {
      const dbErr = err as { code?: string };
      if (dbErr.code === '23503') {
        logger.debug({ endpointId }, 'Endpoint no longer exists; skipping circuit breaker DB mirror');
      } else {
        logger.error({ err, endpointId }, 'Failed to mirror circuit breaker state to PostgreSQL');
      }
    }
  }

  /**
   * Resets circuit breaker for testing or manual administrative override.
   */
  public async reset(endpointId: string): Promise<void> {
    const redis = getSharedRedisClient();
    await Promise.all([
      redis.del(this.stateKey(endpointId)),
      redis.del(this.openUntilKey(endpointId)),
      redis.del(this.failuresKey(endpointId)),
      redis.del(this.probeKey(endpointId)),
    ]);
  }
}

export const circuitBreaker = new CircuitBreaker();
