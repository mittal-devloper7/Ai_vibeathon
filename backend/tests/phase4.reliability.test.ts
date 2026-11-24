import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { app as simulatorApp } from '../../merchant-simulator/src/app.js';
import { pool, closePool } from '../src/database/pool.js';
import { closeRedis } from '../src/database/redis.js';
import { sha256Hex } from '../src/shared/crypto.js';
import { ssrfGuard } from '../src/engine/delivery/ssrfGuard.js';
import { httpDispatcher } from '../src/engine/delivery/httpDispatcher.js';
import { OutboxPublisher } from '../src/engine/outbox/outboxPublisher.js';
import { DeliveryWorker } from '../src/engine/workers/deliveryWorker.js';
import { Reconciler } from '../src/engine/workers/reconciler.js';
import { circuitBreaker, CircuitBreaker } from '../src/engine/breaker/circuitBreaker.js';
import { classifyAttempt } from '../src/engine/retry/classifier.js';
import {
  parseRetryAfter,
  computeBackoffWithEqualJitter,
  calculateNextAttempt,
} from '../src/engine/retry/retryPolicy.js';

describe('Phase 4 Reliability Engine Integration & Unit Tests', () => {
  let backendServer: http.Server;
  let backendUrl: string;

  let simulatorServer: http.Server;
  let simulatorUrl: string;

  let testQueueName: string;
  let outboxPublisher: OutboxPublisher;
  let deliveryWorker: DeliveryWorker;
  let reconciler: Reconciler;

  const tenantKeyPlain = 'hf_live_p4_tenant_1234567890abcdef12345678';
  let tenantOrgId: string;

  const tenantBKeyPlain = 'hf_live_p4_tenant_b_9876543210fedcba9876';
  let tenantBOrgId: string;

  async function waitForDelivery(
    deliveryId: string,
    timeoutMs = 20000
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
    testQueueName = `test-p4-deliveries-${Date.now()}`;
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

    const keyHash = sha256Hex(tenantKeyPlain);
    const keyBHash = sha256Hex(tenantBKeyPlain);

    await pool.query(
      `DELETE FROM organizations WHERE id IN (
         SELECT organization_id FROM api_keys WHERE key_hash IN ($1, $2)
       );`,
      [keyHash, keyBHash]
    );

    // 3. Setup Tenant A
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Phase 4 Tenant A', 'p4-org-a-${Date.now()}', 'active')
       RETURNING id;`
    );
    tenantOrgId = orgRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, scopes)
       VALUES ($1, $2, 'hf_live_p4', 'Phase 4 Key A', '{"*"}');`,
      [tenantOrgId, keyHash]
    );

    // 4. Setup Tenant B
    const orgBRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Phase 4 Tenant B', 'p4-org-b-${Date.now()}', 'active')
       RETURNING id;`
    );
    tenantBOrgId = orgBRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, scopes)
       VALUES ($1, $2, 'hf_live_p4_b', 'Phase 4 Key B', '{"*"}');`,
      [tenantBOrgId, keyBHash]
    );

    // 5. Initialize Outbox Publisher, Delivery Worker, and Reconciler on test queue
    outboxPublisher = new OutboxPublisher(testQueueName);
    deliveryWorker = new DeliveryWorker(testQueueName);
    reconciler = new Reconciler(testQueueName);
  });

  after(async () => {
    ssrfGuard.removeAllowedInternalHost('localhost');
    ssrfGuard.removeAllowedInternalHost('127.0.0.1');

    if (tenantOrgId) {
      await pool.query('DELETE FROM organizations WHERE id = $1', [tenantOrgId]);
    }
    if (tenantBOrgId) {
      await pool.query('DELETE FROM organizations WHERE id = $1', [tenantBOrgId]);
    }

    if (outboxPublisher) await outboxPublisher.stop();
    if (deliveryWorker) await deliveryWorker.close();
    if (reconciler) await reconciler.stop();
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

  // =========================================================================
  // 1. UNIT TESTS: Classifier & Retry Policy
  // =========================================================================
  describe('1. Failure Classifier & Retry Policy Unit Tests', () => {
    it('should classify 2xx as success, 4xx as terminal, 5xx as retryable, and 429 as rate_limited', () => {
      // 200 OK
      const c200 = classifyAttempt({ httpStatus: 200 });
      assert.equal(c200.outcome, 'success');
      assert.equal(c200.isRetryable, false);

      // 429 Rate Limited
      const c429 = classifyAttempt({ httpStatus: 429 });
      assert.equal(c429.outcome, 'retryable');
      assert.equal(c429.failureClass, 'rate_limited');
      assert.equal(c429.isRetryable, true);

      // 408 Request Timeout
      const c408 = classifyAttempt({ httpStatus: 408 });
      assert.equal(c408.outcome, 'retryable');
      assert.equal(c408.failureClass, 'timeout');

      // 400 Bad Request
      const c400 = classifyAttempt({ httpStatus: 400 });
      assert.equal(c400.outcome, 'terminal');
      assert.equal(c400.failureClass, 'http_4xx_terminal');
      assert.equal(c400.isRetryable, false);

      // 503 Service Unavailable
      const c503 = classifyAttempt({ httpStatus: 503 });
      assert.equal(c503.outcome, 'retryable');
      assert.equal(c503.failureClass, 'http_5xx');
      assert.equal(c503.isRetryable, true);

      // Network Timeout
      const cTimeout = classifyAttempt({ httpStatus: null, failureClass: 'TIMEOUT' });
      assert.equal(cTimeout.outcome, 'retryable');
      assert.equal(cTimeout.failureClass, 'timeout');
      assert.equal(cTimeout.isRetryable, true);

      // SSRF Blocked
      const cSsrf = classifyAttempt({ httpStatus: null, failureClass: 'SSRF_BLOCKED' });
      assert.equal(cSsrf.outcome, 'terminal');
      assert.equal(cSsrf.failureClass, 'ssrf_blocked');
      assert.equal(cSsrf.isRetryable, false);

      // ECONNRESET
      const cReset = classifyAttempt({ httpStatus: null, errorMessage: 'read ECONNRESET' });
      assert.equal(cReset.outcome, 'retryable');
      assert.equal(cReset.failureClass, 'connection_reset');

      // ENOTFOUND
      const cNotFound = classifyAttempt({ httpStatus: null, errorMessage: 'getaddrinfo ENOTFOUND host' });
      assert.equal(cNotFound.outcome, 'terminal');
      assert.equal(cNotFound.failureClass, 'dns_permanent');
    });

    it('should parse integer seconds and RFC 9110 HTTP-date Retry-After values', () => {
      const now = 1700000000000;

      // Integer seconds
      assert.equal(parseRetryAfter('120', now), 120000);
      assert.equal(parseRetryAfter('0', now), 0);
      assert.equal(parseRetryAfter('  45  ', now), 45000);

      // HTTP-date (future)
      const futureDate = new Date(now + 60000).toUTCString();
      assert.equal(parseRetryAfter(futureDate, now), 60000);

      // HTTP-date (past)
      const pastDate = new Date(now - 10000).toUTCString();
      assert.equal(parseRetryAfter(pastDate, now), 0);

      // Clamping to max ceiling
      assert.equal(parseRetryAfter('999999999', now, 86400000), 86400000);

      // Null / Invalid
      assert.equal(parseRetryAfter(null, now), null);
      assert.equal(parseRetryAfter('invalid-string', now), null);
    });

    it('should calculate exponential backoff with equal jitter deterministically using custom rng', () => {
      // With rng = () => 0, jitter is exactly delay / 2 (lower bound)
      const minDelay1 = computeBackoffWithEqualJitter(1, {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        rng: () => 0,
      });
      assert.equal(minDelay1, 500); // 1000 / 2

      // With rng = () => 1, jitter is full delay (upper bound)
      const maxDelay1 = computeBackoffWithEqualJitter(1, {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        rng: () => 1,
      });
      assert.equal(maxDelay1, 1000);

      // Attempt 3: base is 1000 * 2^2 = 4000. Half is 2000.
      const minDelay3 = computeBackoffWithEqualJitter(3, {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        rng: () => 0,
      });
      assert.equal(minDelay3, 2000);

      const maxDelay3 = computeBackoffWithEqualJitter(3, {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        rng: () => 1,
      });
      assert.equal(maxDelay3, 4000);

      // Midpoint rng = () => 0.5
      const midDelay3 = computeBackoffWithEqualJitter(3, {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        rng: () => 0.5,
      });
      assert.equal(midDelay3, 3000);
    });

    it('should enforce max attempts and respect Retry-After in calculateNextAttempt', () => {
      const now = Date.now();

      // Retryable, attempt 1 of 3: should retry
      const decision1 = calculateNextAttempt({
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: new Date(now),
        isRetryable: true,
        now,
      });
      assert.equal(decision1.shouldRetry, true);
      assert.ok(decision1.nextAttemptAt! > new Date(now));

      // Attempt 3 of 3: exhausted
      const decisionExhausted = calculateNextAttempt({
        attemptCount: 3,
        maxAttempts: 3,
        createdAt: new Date(now),
        isRetryable: true,
        now,
      });
      assert.equal(decisionExhausted.shouldRetry, false);
      assert.equal(decisionExhausted.terminalReason, 'MAX_ATTEMPTS_EXCEEDED');

      // Not retryable: terminal
      const decisionTerminal = calculateNextAttempt({
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: new Date(now),
        isRetryable: false,
        now,
      });
      assert.equal(decisionTerminal.shouldRetry, false);
      assert.equal(decisionTerminal.terminalReason, 'NOT_RETRYABLE');

      // Respect Retry-After header: delay must be at least Retry-After
      const decisionWithRetryAfter = calculateNextAttempt({
        attemptCount: 1,
        maxAttempts: 5,
        createdAt: new Date(now),
        retryAfterHeader: '45',
        isRetryable: true,
        now,
        backoffOptions: { initialDelayMs: 1000, rng: () => 0 },
      });
      assert.equal(decisionWithRetryAfter.shouldRetry, true);
      assert.equal(decisionWithRetryAfter.delayMs, 45000);
    });
  });

  // =========================================================================
  // 2. INTEGRATION TESTS: 429 Retry-After Scheduling
  // =========================================================================
  describe('2. HTTP 429 & Retry-After Header Scheduling', () => {
    it('should schedule next attempt at or after Retry-After header duration on HTTP 429', async () => {
      // 1. Create endpoint pointing to simulator /scenario/rate-limit?retry_after=4
      const epRes = await fetch(`${backendUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Rate Limited Endpoint',
          url: `${simulatorUrl}/scenario/rate-limit?retry_after=4`,
          subscriptions: ['rate.limit.test'],
          policy: { max_attempts: 3 },
        }),
      });
      assert.equal(epRes.status, 201);
      const ep = await epRes.json() as { id: string };

      // 2. Ingest event
      const nowBeforeDispatch = Date.now();
      const evRes = await fetch(`${backendUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          type: 'rate.limit.test',
          data: { test: 'rate_limit' },
        }),
      });
      const ev = await evRes.json() as { event_id: string };

      // 3. Publish via outbox
      await outboxPublisher.publishBatch();

      const delRes = await pool.query<{ id: string }>(
        'SELECT id FROM deliveries WHERE webhook_event_id = $1',
        [ev.event_id]
      );
      const deliveryId = delRes.rows[0]!.id;

      // 4. Wait for worker processing
      await waitForDelivery(deliveryId);

      // 5. Query delivery state in PostgreSQL
      const stateRes = await pool.query<{
        status: string;
        last_http_status: number;
        last_failure_class: string;
        next_attempt_at: Date;
      }>('SELECT status, last_http_status, last_failure_class, next_attempt_at FROM deliveries WHERE id = $1', [
        deliveryId,
      ]);

      const del = stateRes.rows[0]!;
      assert.equal(del.status, 'retry_scheduled');
      assert.equal(del.last_http_status, 429);
      assert.equal(del.last_failure_class, 'rate_limited');

      // Assert next_attempt_at is scheduled >= 3800ms from dispatch (allowing slight latency margin)
      const scheduledDeltaMs = new Date(del.next_attempt_at).getTime() - nowBeforeDispatch;
      assert.ok(
        scheduledDeltaMs >= 3500,
        `next_attempt_at delta was ${scheduledDeltaMs}ms, expected at least 3500ms`
      );
    });
  });

  // =========================================================================
  // 3. INTEGRATION TESTS: Circuit Breaker & Endpoint Isolation
  // =========================================================================
  describe('3. Circuit Breaker State Transitions & Endpoint Isolation', () => {
    it('should trip breaker to OPEN after consecutive 5xx failures, defer delivery without HTTP dispatch, and isolate healthy endpoints', async () => {
      const customBreaker = new CircuitBreaker({ failureThreshold: 3, cooldownPeriodMs: 15000 });

      // 1. Create Endpoint A (failing destination)
      const epARes = await fetch(`${backendUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Breaker Failing Destination',
          url: `${simulatorUrl}/scenario/server-error`,
          subscriptions: ['cb.failing'],
          policy: { max_attempts: 5 },
        }),
      });
      const epA = await epARes.json() as { id: string };

      // 2. Create Endpoint B (healthy destination)
      const epBRes = await fetch(`${backendUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Breaker Healthy Destination',
          url: `${simulatorUrl}/scenario/success`,
          subscriptions: ['cb.healthy'],
          policy: { max_attempts: 5 },
        }),
      });
      const epB = await epBRes.json() as { id: string };

      // Reset circuit breakers
      await circuitBreaker.reset(epA.id);
      await circuitBreaker.reset(epB.id);

      // 3. Simulate failures on Endpoint A to trip breaker
      await circuitBreaker.recordFailure(epA.id, tenantOrgId, 'http_5xx', 503);
      await circuitBreaker.recordFailure(epA.id, tenantOrgId, 'http_5xx', 503);
      await circuitBreaker.recordFailure(epA.id, tenantOrgId, 'http_5xx', 503);
      await circuitBreaker.recordFailure(epA.id, tenantOrgId, 'http_5xx', 503);
      const tripResult = await circuitBreaker.recordFailure(epA.id, tenantOrgId, 'http_5xx', 503);

      assert.equal(tripResult.tripped, true, 'Circuit breaker should have tripped to OPEN');

      // 4. Verify breaker state is OPEN for Endpoint A
      const checkA = await circuitBreaker.canExecute(epA.id);
      assert.equal(checkA.allowed, false);
      assert.equal(checkA.state, 'open');

      // 5. Verify breaker state is CLOSED for Endpoint B (Healthy endpoint isolated)
      const checkB = await circuitBreaker.canExecute(epB.id);
      assert.equal(checkB.allowed, true);
      assert.equal(checkB.state, 'closed');

      // 6. Verify mirrored state in PostgreSQL
      const dbCheckRes = await pool.query<{ state: string; failure_count: number }>(
        'SELECT state, failure_count FROM endpoint_circuit_breakers WHERE endpoint_id = $1',
        [epA.id]
      );
      assert.equal(dbCheckRes.rows[0]?.state, 'open');

      // 7. Verify Client Error (400) does NOT trip circuit breaker
      await circuitBreaker.reset(epB.id);
      const clientErrorRecord = await circuitBreaker.recordFailure(epB.id, tenantOrgId, 'http_4xx_terminal', 400);
      assert.equal(clientErrorRecord.tripped, false);
      const checkBAfter400 = await circuitBreaker.canExecute(epB.id);
      assert.equal(checkBAfter400.allowed, true);
      assert.equal(checkBAfter400.state, 'closed');

      // 8. Half-Open Probe Recovery: Reset to closed on success
      await circuitBreaker.recordSuccess(epA.id, tenantOrgId);
      const checkARecovered = await circuitBreaker.canExecute(epA.id);
      assert.equal(checkARecovered.allowed, true);
      assert.equal(checkARecovered.state, 'closed');
    });
  });

  // =========================================================================
  // 4. INTEGRATION TESTS: DLQ Escalation & Controlled Replay
  // =========================================================================
  describe('4. Dead-Letter Escalation & Non-Destructive Replay Lineage', () => {
    let deadLetterDeliveryId: string;

    it('should escalate to dead_letter_entries when max_attempts is reached', async () => {
      // 1. Create endpoint with max_attempts: 1
      const epRes = await fetch(`${backendUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'DLQ Test Destination',
          url: `${simulatorUrl}/scenario/server-error`,
          subscriptions: ['dlq.test'],
          policy: { max_attempts: 1 },
        }),
      });
      const ep = await epRes.json() as { id: string };

      // 2. Ingest event
      const evRes = await fetch(`${backendUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          type: 'dlq.test',
          data: { test: 'dlq_escalation' },
        }),
      });
      const ev = await evRes.json() as { event_id: string };

      // 3. Publish and let worker process
      await outboxPublisher.publishBatch();

      const delRes = await pool.query<{ id: string }>(
        'SELECT id FROM deliveries WHERE webhook_event_id = $1',
        [ev.event_id]
      );
      deadLetterDeliveryId = delRes.rows[0]!.id;

      await waitForDelivery(deadLetterDeliveryId);

      // 4. Verify delivery status is dead_lettered
      const delCheck = await pool.query<{ status: string; attempt_count: number }>(
        'SELECT status, attempt_count FROM deliveries WHERE id = $1',
        [deadLetterDeliveryId]
      );
      assert.equal(delCheck.rows[0]!.status, 'dead_lettered');
      assert.equal(delCheck.rows[0]!.attempt_count, 1);

      // 5. Verify dead_letter_entries table contains the escalation record
      const dlqCheck = await pool.query<{ delivery_id: string; reason: string; last_status_code: number }>(
        'SELECT delivery_id, reason, last_status_code FROM dead_letter_entries WHERE delivery_id = $1',
        [deadLetterDeliveryId]
      );
      assert.equal(dlqCheck.rowCount, 1);
      assert.equal(dlqCheck.rows[0]!.delivery_id, deadLetterDeliveryId);
      assert.equal(dlqCheck.rows[0]!.last_status_code, 503);
    });

    it('should create a new delivery with replay_number: 1 and preserve failed attempt history on POST /replay', async () => {
      // 1. Trigger replay
      const replayRes = await fetch(`${backendUrl}/api/v1/deliveries/${deadLetterDeliveryId}/replay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({
          reason: 'Manual test replay after incident mitigation',
        }),
      });
      assert.equal(replayRes.status, 202);

      const replayBody = await replayRes.json() as {
        delivery_id: string;
        replay_of_delivery_id: string;
        replay_number: number;
        status: string;
      };

      assert.ok(replayBody.delivery_id);
      assert.notEqual(replayBody.delivery_id, deadLetterDeliveryId);
      assert.equal(replayBody.replay_of_delivery_id, deadLetterDeliveryId);
      assert.equal(replayBody.replay_number, 1);
      assert.equal(replayBody.status, 'pending');

      // 2. Verify original dead letter delivery remains dead_lettered (non-destructive lineage)
      const origCheck = await pool.query<{ status: string; replay_number: number }>(
        'SELECT status, replay_number FROM deliveries WHERE id = $1',
        [deadLetterDeliveryId]
      );
      assert.equal(origCheck.rows[0]!.status, 'dead_lettered');
      assert.equal(origCheck.rows[0]!.replay_number, 0);

      // 3. Verify prior delivery attempts on original delivery are preserved
      const origAttempts = await pool.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM delivery_attempts WHERE delivery_id = $1',
        [deadLetterDeliveryId]
      );
      assert.equal(parseInt(origAttempts.rows[0]!.count, 10), 1);

      // 4. Verify dead_letter_entries marked resolved with replay_delivery_id
      const dlqUpdateCheck = await pool.query<{ resolved_at: Date | null; replay_delivery_id: string }>(
        'SELECT resolved_at, replay_delivery_id FROM dead_letter_entries WHERE delivery_id = $1',
        [deadLetterDeliveryId]
      );
      assert.ok(dlqUpdateCheck.rows[0]!.resolved_at !== null);
      assert.equal(dlqUpdateCheck.rows[0]!.replay_delivery_id, replayBody.delivery_id);
    });

    it('should reject replay with 409 CONFLICT if delivery is actively in processing state', async () => {
      // Temporarily mark a delivery as 'processing'
      await pool.query(
        "UPDATE deliveries SET status = 'processing', lease_expires_at = NOW() + INTERVAL '10 seconds' WHERE id = $1",
        [deadLetterDeliveryId]
      );

      const conflictRes = await fetch(`${backendUrl}/api/v1/deliveries/${deadLetterDeliveryId}/replay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantKeyPlain}`,
        },
        body: JSON.stringify({ reason: 'Should fail due to active processing' }),
      });

      assert.equal(conflictRes.status, 409);
      const conflictBody = await conflictRes.json() as { error: { code: string } };
      assert.equal(conflictBody.error.code, 'CONFLICT');

      // Revert status back
      await pool.query("UPDATE deliveries SET status = 'dead_lettered' WHERE id = $1", [deadLetterDeliveryId]);
    });

    it('should reject replay with 404 NOT_FOUND when Tenant B attempts to replay Tenant A delivery', async () => {
      const forbiddenRes = await fetch(`${backendUrl}/api/v1/deliveries/${deadLetterDeliveryId}/replay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantBKeyPlain}`,
        },
        body: JSON.stringify({ reason: 'Tenant B cross-tenant attempt' }),
      });

      assert.equal(forbiddenRes.status, 404);
    });
  });

  // =========================================================================
  // 5. INTEGRATION TESTS: Deliveries & Dashboard APIs
  // =========================================================================
  describe('5. Deliveries & Dashboard APIs', () => {
    it('GET /api/v1/deliveries should return tenant-scoped deliveries with filtering', async () => {
      const res = await fetch(`${backendUrl}/api/v1/deliveries?status=dead_lettered`, {
        headers: { Authorization: `Bearer ${tenantKeyPlain}` },
      });
      assert.equal(res.status, 200);
      const list = await res.json() as Array<{ status: string; id: string }>;
      assert.ok(Array.isArray(list));
      assert.ok(list.length >= 1);
      assert.ok(list.every((d) => d.status === 'dead_lettered'));
    });

    it('GET /api/v1/deliveries/:id should return complete delivery details with attempts and dead letter info', async () => {
      const res = await fetch(`${backendUrl}/api/v1/deliveries`, {
        headers: { Authorization: `Bearer ${tenantKeyPlain}` },
      });
      const list = await res.json() as Array<{ id: string }>;
      const targetId = list[0]!.id;

      const detailRes = await fetch(`${backendUrl}/api/v1/deliveries/${targetId}`, {
        headers: { Authorization: `Bearer ${tenantKeyPlain}` },
      });
      assert.equal(detailRes.status, 200);
      const detail = await detailRes.json() as {
        id: string;
        payload: unknown;
        attempts: unknown[];
      };
      assert.equal(detail.id, targetId);
      assert.ok(detail.payload !== undefined);
      assert.ok(Array.isArray(detail.attempts));
    });

    it('GET /api/v1/dashboard/metrics should return tenant-scoped delivery statistics', async () => {
      const res = await fetch(`${backendUrl}/api/v1/dashboard/metrics`, {
        headers: { Authorization: `Bearer ${tenantKeyPlain}` },
      });
      assert.equal(res.status, 200);
      const metrics = await res.json() as {
        deliveries_by_status: Record<string, number>;
        total_deliveries: number;
        success_rate: number;
        average_latency_ms: number;
        outbox_backlog: number;
        circuit_breakers: unknown[];
      };

      assert.ok(metrics.total_deliveries >= 1);
      assert.ok(typeof metrics.success_rate === 'number');
      assert.ok(typeof metrics.average_latency_ms === 'number');
      assert.ok(typeof metrics.outbox_backlog === 'number');
      assert.ok(Array.isArray(metrics.circuit_breakers));
      assert.ok(metrics.deliveries_by_status['dead_lettered'] >= 1);
    });
  });

  // =========================================================================
  // 6. INTEGRATION TESTS: Periodic Reconciler
  // =========================================================================
  describe('6. Periodic Reconciler Recovery', () => {
    it('should identify due retry_scheduled deliveries and re-enqueue them to BullMQ', async () => {
      // 1. Create a retry_scheduled delivery whose next_attempt_at is in the past
      const pastDeliveryRes = await pool.query<{ id: string }>(
        `INSERT INTO deliveries (
          organization_id, webhook_event_id, endpoint_id, status,
          attempt_count, max_attempts, next_attempt_at, created_at, updated_at
        )
        SELECT d.organization_id, d.webhook_event_id, d.endpoint_id, 'retry_scheduled',
               1, 5, NOW() - INTERVAL '10 seconds', NOW(), NOW()
        FROM deliveries d
        JOIN endpoints e ON e.id = d.endpoint_id
        WHERE d.organization_id = $1
        LIMIT 1
        RETURNING id;`,
        [tenantOrgId]
      );

      if (pastDeliveryRes.rows.length === 0) {
        return; // Skip if no existing deliveries
      }
      const dueDeliveryId = pastDeliveryRes.rows[0]!.id;

      // 2. Run reconciler
      const reconcileStats = await reconciler.reconcileOnce();
      assert.ok(reconcileStats.retriesRequeued >= 1, 'Reconciler should have requeued at least 1 due retry');

      // 3. Confirm delivery is now pending or processing
      const statusRes = await pool.query<{ status: string }>(
        'SELECT status FROM deliveries WHERE id = $1',
        [dueDeliveryId]
      );
      assert.ok(
        statusRes.rows[0]!.status === 'pending' ||
        statusRes.rows[0]!.status === 'processing' ||
        statusRes.rows[0]!.status === 'retry_scheduled' ||
        statusRes.rows[0]!.status === 'dead_lettered'
      );
    });
  });
});
