import crypto from 'node:crypto';
import { Worker, Job } from 'bullmq';
import { pool, withTransaction } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { getRedisConnectionOptions } from '../../database/redis.js';
import { signPayload } from '../delivery/hmacSigner.js';
import { httpDispatcher } from '../delivery/httpDispatcher.js';
import { circuitBreaker } from '../breaker/circuitBreaker.js';
import { classifyAttempt } from '../retry/classifier.js';
import { calculateNextAttempt } from '../retry/retryPolicy.js';
import { logger } from '../../shared/logger.js';

export interface DeliveryJobData {
  deliveryId: string;
}

export interface ClaimedDelivery {
  id: string;
  organization_id: string;
  webhook_event_id: string;
  endpoint_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  replay_number: number;
  created_at: Date | string;
  url: string;
  secret: string;
  signing_key_id: string;
  policy: {
    attempt_timeout_ms?: number;
    max_attempts?: number;
  };
  payload: Record<string, unknown>;
  event_type: string;
}

export class DeliveryWorker {
  private worker: Worker<DeliveryJobData>;
  private workerId: string;

  constructor(queueName = env.QUEUE_NAME) {
    this.workerId = `worker-${crypto.randomBytes(4).toString('hex')}`;

    this.worker = new Worker<DeliveryJobData>(
      queueName,
      async (job: Job<DeliveryJobData>) => {
        await this.processJob(job.data.deliveryId);
      },
      {
        connection: getRedisConnectionOptions(),
        concurrency: env.WORKER_CONCURRENCY,
      }
    );

    this.worker.on('error', (err) => {
      logger.error({ err }, 'DeliveryWorker BullMQ error');
    });
  }

  /**
   * Processes a single delivery job:
   * 1. Claims delivery lease in short transaction (FOR UPDATE SKIP LOCKED)
   * 2. Checks per-endpoint circuit breaker state (defers if open)
   * 3. Performs network HTTP I/O outside DB locks
   * 4. Updates circuit breaker and classifies failure
   * 5. Enforces retry policy (exponential backoff + equal jitter + Retry-After)
   * 6. Escalates exhausted/terminal deliveries to dead_letter_entries
   * 7. Records append-only delivery_attempts and updates deliveries matching lease_token
   */
  public async processJob(deliveryId: string): Promise<boolean> {
    const leaseToken = crypto.randomUUID();

    // STEP 1: Short claim transaction
    const claimed = await withTransaction(async (client) => {
      const selectSql = `
        SELECT d.id, d.organization_id, d.webhook_event_id, d.endpoint_id,
               d.status, d.attempt_count, d.max_attempts, d.replay_number, d.created_at,
               e.url, e.secret, e.signing_key_id, e.policy,
               we.payload, we.event_type
        FROM deliveries d
        JOIN endpoints e ON e.id = d.endpoint_id
        JOIN webhook_events we ON we.id = d.webhook_event_id
        WHERE d.id = $1
          AND d.status IN ('pending', 'retry_scheduled')
          AND (d.lease_expires_at IS NULL OR d.lease_expires_at < NOW())
        FOR UPDATE SKIP LOCKED;
      `;

      const { rows } = await client.query<ClaimedDelivery>(selectSql, [deliveryId]);
      if (rows.length === 0) {
        return null; // Already leased, completed, or cancelled
      }

      const row = rows[0]!;

      // Claim the lease
      await client.query(
        `UPDATE deliveries
         SET lease_owner = $1,
             lease_token = $2,
             lease_expires_at = NOW() + INTERVAL '45 seconds',
             status = 'processing',
             attempt_count = attempt_count + 1,
             updated_at = NOW()
         WHERE id = $3;`,
        [this.workerId, leaseToken, deliveryId]
      );

      return row;
    });

    if (!claimed) {
      return false;
    }

    const currentAttemptNo = claimed.attempt_count + 1;
    const timeoutMs = claimed.policy?.attempt_timeout_ms ?? env.DEFAULT_ATTEMPT_TIMEOUT_MS;

    // STEP 2: Circuit Breaker Pre-flight Check
    const cbCheck = await circuitBreaker.canExecute(claimed.endpoint_id);
    if (!cbCheck.allowed) {
      logger.info(
        { deliveryId: claimed.id, endpointId: claimed.endpoint_id, state: cbCheck.state },
        'Circuit breaker open: deferring delivery without outbound network I/O'
      );

      const deferUntil = cbCheck.openUntil || new Date(Date.now() + 5000);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE deliveries
           SET status = 'retry_scheduled',
               next_attempt_at = $1,
               last_failure_class = 'circuit_breaker_open',
               attempt_count = attempt_count - 1, -- revert attempt increment since no attempt made
               lease_token = NULL,
               lease_expires_at = NULL,
               updated_at = NOW()
           WHERE id = $2 AND lease_token = $3 AND status = 'processing';`,
          [deferUntil, claimed.id, leaseToken]
        );
      });
      return false;
    }

    const startedAt = new Date();

    // STEP 3: Network HTTP I/O (zero DB locks held)
    const { headers, payloadBuffer } = signPayload({
      eventId: claimed.webhook_event_id,
      deliveryId: claimed.id,
      keyId: claimed.signing_key_id,
      encryptedSecret: claimed.secret,
      payload: claimed.payload,
    });

    const result = await httpDispatcher.dispatch({
      url: claimed.url,
      payloadBuffer,
      headers,
      timeoutMs,
    });

    const completedAt = new Date();

    // STEP 4: Classification & Circuit Breaker Tracking
    const classification = classifyAttempt({
      httpStatus: result.httpStatus,
      failureClass: result.failureClass,
      errorMessage: result.errorMessage,
      outcome: result.outcome,
    });

    if (classification.outcome === 'success') {
      await circuitBreaker.recordSuccess(claimed.endpoint_id, claimed.organization_id);
    } else {
      await circuitBreaker.recordFailure(
        claimed.endpoint_id,
        claimed.organization_id,
        classification.failureClass,
        result.httpStatus
      );
    }

    // STEP 5: Compute next state & schedule retry or escalate to Dead Letter
    let nextStatus: string;
    let nextAttemptAt: Date | null = null;
    let isDeadLetter = false;
    let deadLetterReason: string | null = null;

    if (classification.outcome === 'success') {
      nextStatus = 'succeeded';
    } else {
      const retryDecision = calculateNextAttempt({
        attemptCount: currentAttemptNo,
        maxAttempts: claimed.max_attempts,
        createdAt: claimed.created_at,
        retryAfterHeader: result.responseHeaders['retry-after'],
        isRetryable: classification.isRetryable,
      });

      if (retryDecision.shouldRetry) {
        nextStatus = 'retry_scheduled';
        nextAttemptAt = retryDecision.nextAttemptAt;
      } else {
        nextStatus = 'dead_lettered';
        isDeadLetter = true;
        deadLetterReason = retryDecision.terminalReason || classification.description;
      }
    }

    // STEP 6: Completion transaction with lease fencing
    await withTransaction(async (client) => {
      // 1. Insert append-only delivery_attempts record
      const insertAttemptSql = `
        INSERT INTO delivery_attempts (
          delivery_id, attempt_number, attempt_no, status_code, response_headers,
          response_body, error_message, duration_ms, started_at, completed_at,
          outcome, failure_class, http_status, latency_ms, remote_ip, request_bytes,
          response_bytes, response_excerpt, key_id
        )
        VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $3, $7, $12, $13, $14, $5, $15);
      `;

      await client.query(insertAttemptSql, [
        claimed.id,
        currentAttemptNo,
        result.httpStatus,
        JSON.stringify(result.responseHeaders),
        result.responseExcerpt,
        result.errorMessage,
        result.latencyMs,
        startedAt,
        completedAt,
        result.outcome,
        classification.failureClass,
        result.remoteIp,
        result.requestBytes,
        result.responseBytes,
        claimed.signing_key_id,
      ]);

      // 2. Dead-letter entry escalation if terminal / exhausted
      if (isDeadLetter) {
        const deadLetterSql = `
          INSERT INTO dead_letter_entries (
            organization_id, delivery_id, endpoint_id, webhook_event_id,
            reason, payload, last_status_code, classified_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW());
        `;
        await client.query(deadLetterSql, [
          claimed.organization_id,
          claimed.id,
          claimed.endpoint_id,
          claimed.webhook_event_id,
          deadLetterReason || 'DELIVERY_FAILED',
          claimed.payload,
          result.httpStatus,
        ]);
        logger.warn(
          { deliveryId: claimed.id, reason: deadLetterReason },
          'Delivery escalated to dead_letter_entries'
        );
      }

      // 3. Fenced update strictly checking lease_token and status = 'processing'
      const updateDeliverySql = `
        UPDATE deliveries
        SET status = $1,
            last_http_status = $2,
            last_failure_class = $3,
            next_attempt_at = $4,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE id = $5 AND lease_token = $6 AND status = 'processing'
        RETURNING id;
      `;

      const updateRes = await client.query(updateDeliverySql, [
        nextStatus,
        result.httpStatus,
        classification.failureClass,
        nextAttemptAt,
        claimed.id,
        leaseToken,
      ]);

      if (updateRes.rows.length === 0) {
        logger.warn(
          { deliveryId: claimed.id, leaseToken },
          'Lease fencing check failed: delivery row was modified or expired while worker dispatched'
        );
      }
    });

    return true;
  }

  public async close(): Promise<void> {
    await this.worker.close();
    logger.info('DeliveryWorker closed cleanly');
  }
}
