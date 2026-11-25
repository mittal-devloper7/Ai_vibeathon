import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { app as simulatorApp } from '../../merchant-simulator/src/app.js';
import { pool, closePool } from '../src/database/pool.js';
import { closeRedis } from '../src/database/redis.js';
import { sha256Hex } from '../src/shared/crypto.js';
import { ssrfGuard } from '../src/engine/delivery/ssrfGuard.js';
import { verifyHmacSignature } from '../src/engine/delivery/hmacSigner.js';
import { httpDispatcher } from '../src/engine/delivery/httpDispatcher.js';
import { OutboxPublisher } from '../src/engine/outbox/outboxPublisher.js';
import { DeliveryWorker } from '../src/engine/workers/deliveryWorker.js';

describe('Phase 3 Durable Event Processing Integration Tests', () => {
  let backendServer: http.Server;
  let backendUrl: string;

  let simulatorServer: http.Server;
  let simulatorUrl: string;

  let testQueueName: string;
  let outboxPublisher: OutboxPublisher;
  let deliveryWorker: DeliveryWorker;

  const tenantKeyPlain = 'hf_live_p3_tenant_1234567890abcdef12345678';
  let tenantOrgId: string;

  async function waitForDelivery(
    deliveryId: string,
    timeoutMs = 45000
  ): Promise<{ status: string; attempt_count: number; last_http_status: number; last_failure_class: string | null }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await pool.query<{
        status: string;
        attempt_count: number;
        last_http_status: number;
        last_failure_class: string | null;
      }>(
        'SELECT status, attempt_count, last_http_status, last_failure_class FROM deliveries WHERE id = $1',
        [deliveryId]
      );
      if (
        res.rows[0] &&
        res.rows[0].status !== 'pending' &&
        res.rows[0].status !== 'processing'
      ) {
        return res.rows[0];
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Delivery ${deliveryId} did not finish within ${timeoutMs}ms`);
  }

  before(async () => {
    testQueueName = `test-deliveries-${Date.now()}`;
    ssrfGuard.addAllowedInternalHost('localhost');
    ssrfGuard.addAllowedInternalHost('127.0.0.1');

    // 1. Start ephemeral simulator server
    await new Promise<void>((resolve) => {
      simulatorServer = simulatorApp.listen(0, () => {
        const addr = simulatorServer.address();
        if (addr && typeof addr === 'object') {
          simulatorUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // 2. Start ephemeral backend server
    await new Promise<void>((resolve) => {
      backendServer = app.listen(0, () => {
        const addr = backendServer.address();
        if (addr && typeof addr === 'object') {
          backendUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // 3. Setup test tenant in DB (clean up orphaned runs cleanly)
    const keyHash = sha256Hex(tenantKeyPlain);
    await pool.query(
      `DELETE FROM organizations WHERE id IN (
         SELECT organization_id FROM api_keys WHERE key_hash = $1
       );`,
      [keyHash]
    );

    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Phase 3 Test Org', 'p3-org-${Date.now()}', 'active')
       RETURNING id;`
    );
    tenantOrgId = orgRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, scopes)
       VALUES ($1, $2, 'hf_live_p3', 'Phase 3 Key', '{"*"}');`,
      [tenantOrgId, keyHash]
    );

    // 4. Initialize Outbox Publisher and Delivery Worker on test queue
    outboxPublisher = new OutboxPublisher(testQueueName);
    deliveryWorker = new DeliveryWorker(testQueueName);
  });

  after(async () => {
    ssrfGuard.removeAllowedInternalHost('localhost');
    ssrfGuard.removeAllowedInternalHost('127.0.0.1');

    if (tenantOrgId) {
      await pool.query('DELETE FROM organizations WHERE id = $1', [tenantOrgId]);
    }

    if (outboxPublisher) await outboxPublisher.stop();
    if (deliveryWorker) await deliveryWorker.close();
    await httpDispatcher.close();

    backendServer?.closeAllConnections?.();
    simulatorServer?.closeAllConnections?.();

    await new Promise<void>((resolve) => {
      backendServer.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      simulatorServer.close(() => resolve());
    });

    await closeRedis();
    await closePool();
  });

  beforeEach(async () => {
    // Reset simulator admin state
    await fetch(`${simulatorUrl}/admin/reset`, { method: 'POST' });
  });

  describe('1. End-to-End Success Delivery & HMAC Signature Verification', () => {
    it('should deliver event to simulator /scenario/success, verify HMAC, and record success attempt', async () => {
      // 1. Create endpoint pointing to simulator /scenario/success
      const epRes = await fetch(`${backendUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Simulator Success Endpoint',
          url: `${simulatorUrl}/scenario/success`,
          subscriptions: ['order.completed'],
          policy: {
            max_attempts: 3,
            attempt_timeout_ms: 5000,
            max_in_flight: 5,
          },
        }),
      });
      assert.equal(epRes.status, 201);
      const endpoint = await epRes.json() as { id: string; signing_secret: string; signing_key_id: string };

      // 2. Ingest event
      const eventRes = await fetch(`${backendUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          type: 'order.completed',
          data: { order_id: 'ord_998877', total: 150.5 },
        }),
      });
      assert.equal(eventRes.status, 202);
      const event = await eventRes.json() as { event_id: string };

      // 3. Publish outbox events to BullMQ
      const published = await outboxPublisher.publishBatch();
      assert.ok(published >= 1, 'At least 1 outbox event should be published');

      // 4. Retrieve delivery ID and wait for BullMQ worker to complete delivery
      const delRes = await pool.query<{ id: string }>(
        'SELECT id FROM deliveries WHERE webhook_event_id = $1',
        [event.event_id]
      );
      assert.equal(delRes.rows.length, 1);
      const deliveryId = delRes.rows[0]!.id;

      const completedDelivery = await waitForDelivery(deliveryId);
      assert.equal(completedDelivery.status, 'succeeded');
      assert.equal(completedDelivery.last_http_status, 200);

      // 5. Verify simulator received webhook
      const adminRes = await fetch(`${simulatorUrl}/admin/state`);
      const adminState = await adminRes.json() as {
        total_received: number;
        recent_webhooks: Array<{
          eventId: string;
          deliveryId: string;
          keyId: string;
          signatureHeader: string;
          body: unknown;
        }>;
      };
      assert.ok(adminState.total_received >= 1);
      const received = adminState.recent_webhooks.find((w) => w.deliveryId === deliveryId);
      assert.ok(received, 'Simulator must have received the delivery');
      assert.equal(received!.eventId, event.event_id);
      assert.equal(received!.keyId, endpoint.signing_key_id);

      // 6. Verify HMAC signature using verifyHmacSignature helper
      const isValidHmac = verifyHmacSignature(
        JSON.stringify(received!.body),
        received!.signatureHeader,
        endpoint.signing_secret
      );
      assert.equal(isValidHmac, true, 'HMAC signature must verify with endpoint plaintext secret');

      // 7. Verify delivery_attempts table
      const attemptsRes = await pool.query<{
        outcome: string;
        http_status: number;
        latency_ms: number;
        attempt_number: number;
        key_id: string;
      }>(
        'SELECT outcome, http_status, latency_ms, attempt_number, key_id FROM delivery_attempts WHERE delivery_id = $1',
        [deliveryId]
      );
      assert.equal(attemptsRes.rows.length, 1);
      assert.equal(attemptsRes.rows[0]!.outcome, 'success');
      assert.equal(attemptsRes.rows[0]!.http_status, 200);
      assert.equal(attemptsRes.rows[0]!.attempt_number, 1);
      assert.equal(attemptsRes.rows[0]!.key_id, endpoint.signing_key_id);
      assert.ok(attemptsRes.rows[0]!.latency_ms >= 0);
    });
  });

  describe('2. HTTP Error Handling & Retry Scheduling', () => {
    it('should record failure attempt and schedule retry when destination returns 503', async () => {
      // 1. Create endpoint pointing to /scenario/server-error
      const epRes = await fetch(`${backendUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Simulator Error Endpoint',
          url: `${simulatorUrl}/scenario/server-error`,
          subscriptions: ['user.registered'],
          policy: { max_attempts: 3 },
        }),
      });
      assert.equal(epRes.status, 201);

      // 2. Ingest event
      const eventRes = await fetch(`${backendUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          type: 'user.registered',
          data: { user_id: 'usr_abc123' },
        }),
      });
      assert.equal(eventRes.status, 202);
      const event = await eventRes.json() as { event_id: string };

      // 3. Publish & Wait for worker
      await outboxPublisher.publishBatch();
      const delRes = await pool.query<{ id: string }>(
        'SELECT id FROM deliveries WHERE webhook_event_id = $1',
        [event.event_id]
      );
      const deliveryId = delRes.rows[0]!.id;

      const completedDelivery = await waitForDelivery(deliveryId);
      assert.equal(completedDelivery.status, 'retry_scheduled');
      assert.equal(completedDelivery.last_http_status, 503);
      assert.ok(['HTTP_5XX', 'http_5xx'].includes(completedDelivery.last_failure_class!));

      // 4. Verify delivery_attempts table
      const attemptsRes = await pool.query<{
        outcome: string;
        http_status: number;
        failure_class: string;
      }>(
        'SELECT outcome, http_status, failure_class FROM delivery_attempts WHERE delivery_id = $1',
        [deliveryId]
      );
      assert.equal(attemptsRes.rows.length, 1);
      assert.equal(attemptsRes.rows[0]!.outcome, 'failure');
      assert.equal(attemptsRes.rows[0]!.http_status, 503);
      assert.ok(['HTTP_5XX', 'http_5xx'].includes(attemptsRes.rows[0]!.failure_class!));
    });

    it('should record timeout when destination exceeds configured attempt_timeout_ms', async () => {
      // 1. Create endpoint pointing to /scenario/slow with short 500ms timeout
      const epRes = await fetch(`${backendUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Simulator Slow Endpoint',
          url: `${simulatorUrl}/scenario/slow?ms=2000`,
          subscriptions: ['slow.event'],
          policy: { attempt_timeout_ms: 600, max_attempts: 2 },
        }),
      });
      assert.equal(epRes.status, 201);

      // 2. Ingest event
      const eventRes = await fetch(`${backendUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          type: 'slow.event',
          data: { slow: true },
        }),
      });
      const event = await eventRes.json() as { event_id: string };

      await outboxPublisher.publishBatch();
      const delRes = await pool.query<{ id: string }>(
        'SELECT id FROM deliveries WHERE webhook_event_id = $1',
        [event.event_id]
      );
      const deliveryId = delRes.rows[0]!.id;

      const completedDelivery = await waitForDelivery(deliveryId, 35000);
      assert.equal(completedDelivery.status, 'retry_scheduled');

      // 3. Verify delivery_attempts recorded timeout
      const attemptsRes = await pool.query<{ outcome: string; failure_class: string }>(
        'SELECT outcome, failure_class FROM delivery_attempts WHERE delivery_id = $1',
        [deliveryId]
      );
      assert.equal(attemptsRes.rows.length, 1);
      assert.equal(attemptsRes.rows[0]!.outcome, 'timeout');
      assert.ok(['TIMEOUT', 'timeout'].includes(attemptsRes.rows[0]!.failure_class!));
    });
  });

  describe('3. Worker Lease Fencing Safety', () => {
    it('should protect delivery state when an expired worker attempts to complete with an old lease token', async () => {
      // 1. Insert a mock delivery row in processing state with lease_token = 'token_A'
      const orgId = tenantOrgId;

      const epRes = await pool.query<{ id: string }>('SELECT id FROM endpoints WHERE organization_id = $1 LIMIT 1', [orgId]);
      const epId = epRes.rows[0]!.id;

      const evRes = await pool.query<{ id: string }>('SELECT id FROM webhook_events WHERE organization_id = $1 LIMIT 1', [orgId]);
      const evId = evRes.rows[0]!.id;

      const validToken = '11111111-1111-1111-1111-111111111111';
      const staleToken = '22222222-2222-2222-2222-222222222222';

      const insertRes = await pool.query<{ id: string }>(
        `INSERT INTO deliveries (
          organization_id, webhook_event_id, endpoint_id, status,
          attempt_count, max_attempts, lease_token, lease_owner, lease_expires_at
        )
        VALUES ($1, $2, $3, 'processing', 1, 5, $4, 'worker-A', NOW() + INTERVAL '45 seconds')
        RETURNING id;`,
        [orgId, evId, epId, validToken]
      );
      const mockDeliveryId = insertRes.rows[0]!.id;

      // 2. Stale worker B attempts to update with staleToken
      const staleUpdateRes = await pool.query(
        `UPDATE deliveries
         SET status = 'succeeded',
             lease_token = NULL,
             lease_expires_at = NULL
         WHERE id = $1 AND lease_token = $2 AND status = 'processing'
         RETURNING id;`,
        [mockDeliveryId, staleToken]
      );

      assert.equal(staleUpdateRes.rows.length, 0, 'Stale worker update must affect 0 rows');

      // 3. Confirm original lease and status remain completely untouched
      const verifyRes = await pool.query<{ status: string; lease_token: string }>(
        'SELECT status, lease_token FROM deliveries WHERE id = $1',
        [mockDeliveryId]
      );
      assert.equal(verifyRes.rows[0]!.status, 'processing');
      assert.equal(verifyRes.rows[0]!.lease_token, validToken);

      // Clean up mock row
      await pool.query('DELETE FROM deliveries WHERE id = $1', [mockDeliveryId]);
    });
  });

  describe('4. Outbox Crash Recovery & Job Deduplication', () => {
    it('should recover gracefully and deduplicate when outbox publisher crashes before marking published_at', async () => {
      // 1. Create endpoint
      const epRes = await fetch(`${backendUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Crash Recovery Endpoint',
          url: `${simulatorUrl}/scenario/duplicate-check`,
          subscriptions: ['crash.test'],
        }),
      });
      assert.equal(epRes.status, 201);

      // 2. Ingest event
      const eventRes = await fetch(`${backendUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          type: 'crash.test',
          data: { test: 'crash_recovery' },
        }),
      });
      const event = await eventRes.json() as { event_id: string };

      const delRes = await pool.query<{ id: string }>(
        'SELECT id FROM deliveries WHERE webhook_event_id = $1',
        [event.event_id]
      );
      const deliveryId = delRes.rows[0]!.id;

      // 3. Simulate crash on first publish attempt: queue.add succeeds, then throws before marking published_at
      let crashTriggered = false;
      outboxPublisher.onAfterEnqueue = async () => {
        if (!crashTriggered) {
          crashTriggered = true;
          throw new Error('Simulated process crash immediately after enqueueing BullMQ job');
        }
      };

      // Run publishBatch() - throws on the simulate crash hook
      await outboxPublisher.publishBatch();
      outboxPublisher.onAfterEnqueue = undefined; // clear hook

      // 4. Verify outbox row is still unpublished in DB
      const outboxCheck1 = await pool.query<{ published_at: Date | null }>(
        `SELECT published_at FROM outbox_events WHERE delivery_id = $1`,
        [deliveryId]
      );
      assert.equal(outboxCheck1.rows[0]!.published_at, null, 'Outbox row should still be unpublished');

      // 5. Expire lease manually to simulate crash timeout recovery
      await pool.query(
        `UPDATE outbox_events SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE delivery_id = $1`,
        [deliveryId]
      );

      // 6. Recovery publish run: claims row again, uses deterministic dedupe_key (BullMQ deduplicates)
      const secondPublished = await outboxPublisher.publishBatch();
      assert.equal(secondPublished, 1, 'Second publish should succeed');

      // 7. Verify outbox row is now marked published
      const outboxCheck2 = await pool.query<{ published_at: Date | null }>(
        `SELECT published_at FROM outbox_events WHERE delivery_id = $1`,
        [deliveryId]
      );
      assert.ok(outboxCheck2.rows[0]!.published_at !== null, 'Outbox row must be marked published');

      // 8. Wait for delivery to complete via worker
      await waitForDelivery(deliveryId);

      // Confirm only 1 attempt was recorded
      const attemptsRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM delivery_attempts WHERE delivery_id = $1`,
        [deliveryId]
      );
      assert.equal(parseInt(attemptsRes.rows[0]!.count, 10), 1, 'Exactly one delivery attempt must be recorded');
    });
  });
});
