import { Queue } from 'bullmq';
import { pool, withTransaction } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { getRedisConnectionOptions } from '../../database/redis.js';
import { OutboxPublisher } from '../outbox/outboxPublisher.js';
import { logger } from '../../shared/logger.js';

export interface ReconcileResult {
  retriesRequeued: number;
  stalledRecovered: number;
  outboxPublished: number;
}

export class Reconciler {
  private queue: Queue;
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private outboxPublisher: OutboxPublisher;
  private queueName: string;

  constructor(queueName = env.QUEUE_NAME) {
    this.queueName = queueName;
    this.queue = new Queue(queueName, {
      connection: getRedisConnectionOptions(),
    });
    this.outboxPublisher = new OutboxPublisher(queueName);
  }

  /**
   * Executes a single reconciliation cycle across PostgreSQL and BullMQ:
   * 1. Re-queues due `retry_scheduled` deliveries whose `next_attempt_at <= NOW()`
   * 2. Recovers stalled `processing` deliveries whose `lease_expires_at < NOW()`
   * 3. Publishes pending / expired outbox events to BullMQ
   */
  public async reconcileOnce(): Promise<ReconcileResult> {
    let retriesRequeued = 0;
    let stalledRecovered = 0;
    let outboxPublished = 0;

    // 1. Recover due retries
    try {
      const dueRows = await withTransaction(async (client) => {
        const sql = `
          WITH due AS (
            SELECT id
            FROM deliveries
            WHERE status = 'retry_scheduled'
              AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            ORDER BY next_attempt_at ASC NULLS FIRST
            LIMIT 50
            FOR UPDATE SKIP LOCKED
          )
          UPDATE deliveries
          SET status = 'pending',
              lease_token = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
          FROM due
          WHERE deliveries.id = due.id
          RETURNING deliveries.id;
        `;
        const res = await client.query<{ id: string }>(sql);
        return res.rows;
      });

      for (const row of dueRows) {
        const sanitizedJobId = `delivery__${row.id}__reconcile__${Date.now()}`;
        await this.queue.add(
          'dispatch',
          { deliveryId: row.id },
          {
            jobId: sanitizedJobId,
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }
        );
        retriesRequeued++;
      }
    } catch (err) {
      logger.error({ err }, 'Error reconciling due retries in Reconciler');
    }

    // 2. Recover stalled processing leases
    try {
      const stalledRows = await withTransaction(async (client) => {
        const sql = `
          WITH stalled AS (
            SELECT id
            FROM deliveries
            WHERE status = 'processing'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at < NOW()
            ORDER BY lease_expires_at ASC
            LIMIT 50
            FOR UPDATE SKIP LOCKED
          )
          UPDATE deliveries
          SET status = 'pending',
              lease_token = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
          FROM stalled
          WHERE deliveries.id = stalled.id
          RETURNING deliveries.id;
        `;
        const res = await client.query<{ id: string }>(sql);
        return res.rows;
      });

      for (const row of stalledRows) {
        const sanitizedJobId = `delivery__${row.id}__stalled_recovery__${Date.now()}`;
        await this.queue.add(
          'dispatch',
          { deliveryId: row.id },
          {
            jobId: sanitizedJobId,
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }
        );
        stalledRecovered++;
      }
    } catch (err) {
      logger.error({ err }, 'Error recovering stalled delivery leases in Reconciler');
    }

    // 3. Publish pending or expired outbox events
    try {
      outboxPublished = await this.outboxPublisher.publishBatch(50);
    } catch (err) {
      logger.error({ err }, 'Error reconciling outbox events in Reconciler');
    }

    if (retriesRequeued > 0 || stalledRecovered > 0 || outboxPublished > 0) {
      logger.info(
        { retriesRequeued, stalledRecovered, outboxPublished },
        'Reconciler cycle completed with recovered work'
      );
    }

    return { retriesRequeued, stalledRecovered, outboxPublished };
  }

  /**
   * Starts periodic polling reconciliation loop.
   */
  public start(intervalMs = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.reconcileOnce();
      } catch (err) {
        logger.error({ err }, 'Error in reconciler periodic execution');
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(poll, intervalMs);
        }
      }
    };

    poll();
    logger.info({ intervalMs }, 'Reconciler background loop started');
  }

  /**
   * Stops periodic reconciler cleanly.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.outboxPublisher.stop();
    await this.queue.close();
    logger.info('Reconciler stopped cleanly');
  }
}
