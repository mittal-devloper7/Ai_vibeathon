import crypto from 'node:crypto';
import { Queue } from 'bullmq';
import { pool, withTransaction } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { getRedisConnectionOptions } from '../../database/redis.js';
import { logger } from '../../shared/logger.js';

export interface OutboxClaimedRow {
  id: string;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
}

export class OutboxPublisher {
  private queue: Queue;
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private workerId: string;

  // Test hook to simulate crash between enqueue and marking published_at
  public onAfterEnqueue?: (rowId: string) => Promise<void> | void;

  constructor(queueName = env.QUEUE_NAME) {
    this.workerId = `publisher-${crypto.randomBytes(4).toString('hex')}`;
    this.queue = new Queue(queueName, {
      connection: getRedisConnectionOptions(),
    });
  }

  /**
   * Claims a batch of unpublished outbox events using FOR UPDATE SKIP LOCKED
   * with a lease token, committing the claim transaction before publishing.
   */
  public async claimBatch(batchSize = 50): Promise<{ rows: OutboxClaimedRow[]; leaseToken: string }> {
    const leaseToken = crypto.randomUUID();

    const claimed = await withTransaction(async (client) => {
      const claimSql = `
        WITH due AS (
          SELECT id
          FROM outbox_events
          WHERE published_at IS NULL
            AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
          ORDER BY created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox_events
        SET lease_owner = $2,
            lease_token = $3,
            lease_expires_at = NOW() + INTERVAL '30 seconds',
            attempts = attempts + 1,
            status = 'processing'
        FROM due
        WHERE outbox_events.id = due.id
        RETURNING outbox_events.id, outbox_events.payload, outbox_events.dedupe_key;
      `;

      const { rows } = await client.query<{
        id: string;
        payload: unknown;
        dedupe_key: string | null;
      }>(claimSql, [batchSize, this.workerId, leaseToken]);

      const parsedRows: OutboxClaimedRow[] = rows.map((r) => ({
        id: r.id,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload as Record<string, unknown>),
        dedupe_key: r.dedupe_key,
      }));

      return parsedRows;
    });

    return { rows: claimed, leaseToken };
  }

  /**
   * Publishes claimed outbox rows to BullMQ and marks published_at = now()
   * in a separate transaction after queue.add succeeds.
   */
  public async publishBatch(batchSize = 50): Promise<number> {
    const { rows, leaseToken } = await this.claimBatch(batchSize);
    if (rows.length === 0) return 0;

    let publishedCount = 0;

    for (const row of rows) {
      const deliveryId = (row.payload['delivery_id'] as string) || (row.payload['deliveryId'] as string);
      const rawJobId = row.dedupe_key || `delivery_${deliveryId}_dispatch`;
      // BullMQ v5 disallows colons in custom job IDs
      const jobId = rawJobId.replace(/:/g, '__');

      try {
        // Enqueue to BullMQ
        await this.queue.add(
          'dispatch',
          { deliveryId },
          {
            jobId,
            removeOnComplete: true,
            removeOnFail: false,
          }
        );

        // Test hook execution
        if (this.onAfterEnqueue) {
          await this.onAfterEnqueue(row.id);
        }

        // Mark as published in separate query
        await pool.query(
          `UPDATE outbox_events
           SET published_at = NOW(),
               status = 'published',
               lease_token = NULL,
               lease_expires_at = NULL
           WHERE id = $1 AND lease_token = $2;`,
          [row.id, leaseToken]
        );

        publishedCount++;
      } catch (err) {
        logger.error({ err, rowId: row.id, deliveryId }, 'Failed to publish outbox event to BullMQ');
      }
    }

    return publishedCount;
  }

  /**
   * Starts periodic polling loop for unpublished outbox events.
   */
  public start(pollIntervalMs = 250): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.publishBatch(50);
      } catch (err) {
        logger.error({ err }, 'Error in outbox publisher polling cycle');
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(poll, pollIntervalMs);
        }
      }
    };

    poll();
    logger.info({ workerId: this.workerId }, 'OutboxPublisher loop started');
  }

  /**
   * Stops publisher loop and closes BullMQ queue.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.queue.close();
    logger.info('OutboxPublisher stopped cleanly');
  }
}
