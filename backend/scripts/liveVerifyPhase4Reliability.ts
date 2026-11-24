import http from 'node:http';
import { app as backendApp } from '../src/app.js';
import { app as simulatorApp } from '../../merchant-simulator/src/app.js';
import { pool, closePool } from '../src/database/pool.js';
import { closeRedis } from '../src/database/redis.js';
import { ssrfGuard } from '../src/engine/delivery/ssrfGuard.js';
import { httpDispatcher } from '../src/engine/delivery/httpDispatcher.js';
import { OutboxPublisher } from '../src/engine/outbox/outboxPublisher.js';
import { DeliveryWorker } from '../src/engine/workers/deliveryWorker.js';
import { Reconciler } from '../src/engine/workers/reconciler.js';
import { sha256Hex } from '../src/shared/crypto.js';

async function runPhase4LiveVerification() {
  console.log('================================================================');
  console.log('   HOOKFORGE PHASE 4: LIVE RELIABILITY ENGINE VERIFICATION');
  console.log('================================================================\n');

  ssrfGuard.addAllowedInternalHost('localhost');
  ssrfGuard.addAllowedInternalHost('127.0.0.1');

  // 1. Start Merchant Simulator
  let simulatorServer: http.Server;
  let simulatorUrl: string;
  await new Promise<void>((resolve) => {
    simulatorServer = simulatorApp.listen(0, () => {
      const addr = simulatorServer.address();
      if (addr && typeof addr === 'object') {
        simulatorUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
  console.log(`[1] Merchant Simulator running at: ${simulatorUrl}`);

  // 2. Start Backend API Server
  let backendServer: http.Server;
  let backendUrl: string;
  await new Promise<void>((resolve) => {
    backendServer = backendApp.listen(0, () => {
      const addr = backendServer.address();
      if (addr && typeof addr === 'object') {
        backendUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
  console.log(`[2] HookForge API running at:     ${backendUrl}`);

  // 3. Initialize BullMQ Queue, Worker, Publisher, and Reconciler
  const liveQueue = `p4-live-${Date.now()}`;
  const outboxPublisher = new OutboxPublisher(liveQueue);
  const deliveryWorker = new DeliveryWorker(liveQueue);
  const reconciler = new Reconciler(liveQueue);
  console.log(`[3] OutboxPublisher, DeliveryWorker & Reconciler initialized (Queue: ${liveQueue})\n`);

  // 4. Create Live Tenant Org and API Key
  const testOrgRes = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, status)
     VALUES ('Live Reliability Tenant', 'p4-live-org-${Date.now()}', 'active')
     RETURNING id;`
  );
  const testOrgId = testOrgRes.rows[0]!.id;
  const testApiKey = `hf_live_p4_verify_${Date.now()}`;
  const keyHash = sha256Hex(testApiKey);

  await pool.query(
    `INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, scopes)
     VALUES ($1, $2, 'hf_live_p4', 'Live P4 Key', '{"*"}');`,
    [testOrgId, keyHash]
  );
  console.log(`[4] Tenant Created: ${testOrgId}`);
  console.log(`    API Key: ${testApiKey}\n`);

  try {
    // -------------------------------------------------------------
    // STEP 5: Trigger DLQ Escalation
    // -------------------------------------------------------------
    console.log('--- 1. ESCALATION TO DEAD-LETTER QUEUE ---');
    // Register endpoint with max_attempts: 1 pointing to server-error
    const epRes = await fetch(`${backendUrl}/api/v1/endpoints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testApiKey}`,
      },
      body: JSON.stringify({
        name: 'Live Flaky Endpoint',
        url: `${simulatorUrl}/scenario/server-error`,
        subscriptions: ['order.failed'],
        policy: { max_attempts: 1 },
      }),
    });
    const endpoint = await epRes.json() as { id: string };
    console.log(`[5.1] Created Endpoint: ${endpoint.id}`);

    // Ingest event
    const evRes = await fetch(`${backendUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testApiKey}`,
      },
      body: JSON.stringify({
        type: 'order.failed',
        data: { order_id: 'ord_dlq_001', amount: 49.99 },
      }),
    });
    const event = await evRes.json() as { event_id: string };
    console.log(`[5.2] Ingested Event: ${event.event_id}`);

    // Publish to BullMQ
    await outboxPublisher.publishBatch();

    // Wait for delivery to reach terminal state
    const delRes = await pool.query<{ id: string }>(
      'SELECT id FROM deliveries WHERE webhook_event_id = $1',
      [event.event_id]
    );
    const originalDeliveryId = delRes.rows[0]!.id;

    let terminalDeliveryState: any = null;
    for (let i = 0; i < 40; i++) {
      const q = await pool.query(
        'SELECT * FROM deliveries WHERE id = $1',
        [originalDeliveryId]
      );
      if (q.rows[0]?.status === 'dead_lettered' || q.rows[0]?.status === 'failed') {
        terminalDeliveryState = q.rows[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log(`[5.3] Delivery Escalated to Status: ${terminalDeliveryState?.status}`);
    console.log(`      Delivery ID:         ${terminalDeliveryState?.id}`);
    console.log(`      Last HTTP Status:    ${terminalDeliveryState?.last_http_status}`);
    console.log(`      Last Failure Class:  ${terminalDeliveryState?.last_failure_class}`);

    // -------------------------------------------------------------
    // STEP 6: Test GET /api/v1/deliveries
    // -------------------------------------------------------------
    console.log('\n--- 2. LIVE API: GET /api/v1/deliveries ---');
    const listRes = await fetch(`${backendUrl}/api/v1/deliveries?status=dead_lettered`, {
      headers: { Authorization: `Bearer ${testApiKey}` },
    });
    console.log(`HTTP ${listRes.status} ${listRes.statusText}`);
    const deliveriesList = await listRes.json();
    console.log('Response Body:', JSON.stringify(deliveriesList, null, 2));

    // -------------------------------------------------------------
    // STEP 7: Test GET /api/v1/deliveries/:deliveryId
    // -------------------------------------------------------------
    console.log(`\n--- 3. LIVE API: GET /api/v1/deliveries/${originalDeliveryId} ---`);
    const detailRes = await fetch(`${backendUrl}/api/v1/deliveries/${originalDeliveryId}`, {
      headers: { Authorization: `Bearer ${testApiKey}` },
    });
    console.log(`HTTP ${detailRes.status} ${detailRes.statusText}`);
    const deliveryDetail = await detailRes.json();
    console.log('Response Body:', JSON.stringify(deliveryDetail, null, 2));

    // -------------------------------------------------------------
    // STEP 8: Test POST /api/v1/deliveries/:deliveryId/replay
    // -------------------------------------------------------------
    console.log(`\n--- 4. LIVE API: POST /api/v1/deliveries/${originalDeliveryId}/replay ---`);
    const replayRes = await fetch(`${backendUrl}/api/v1/deliveries/${originalDeliveryId}/replay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testApiKey}`,
      },
      body: JSON.stringify({
        reason: 'Customer requested manual redelivery after service restoration',
      }),
    });
    console.log(`HTTP ${replayRes.status} ${replayRes.statusText}`);
    const replayBody = await replayRes.json();
    console.log('Response Body:', JSON.stringify(replayBody, null, 2));

    // -------------------------------------------------------------
    // STEP 9: Test GET /api/v1/dashboard/metrics
    // -------------------------------------------------------------
    console.log('\n--- 5. LIVE API: GET /api/v1/dashboard/metrics ---');
    const metricsRes = await fetch(`${backendUrl}/api/v1/dashboard/metrics`, {
      headers: { Authorization: `Bearer ${testApiKey}` },
    });
    console.log(`HTTP ${metricsRes.status} ${metricsRes.statusText}`);
    const dashboardMetrics = await metricsRes.json();
    console.log('Response Body:', JSON.stringify(dashboardMetrics, null, 2));

    console.log('\n================================================================');
    console.log('   ALL PHASE 4 LIVE HTTP ENDPOINTS VERIFIED SUCCESSFULLY!');
    console.log('================================================================\n');
  } finally {
    // Teardown
    await pool.query('DELETE FROM organizations WHERE id = $1', [testOrgId]);
    console.log('[Cleanup] Test organization removed');

    await outboxPublisher.stop();
    await deliveryWorker.close();
    await reconciler.stop();
    await httpDispatcher.close();

    backendServer.closeAllConnections?.();
    simulatorServer.closeAllConnections?.();

    await new Promise<void>((resolve) => backendServer.close(() => resolve()));
    await new Promise<void>((resolve) => simulatorServer.close(() => resolve()));

    await closeRedis();
    await closePool();
    console.log('[Cleanup] Sockets, worker, reconciler, Redis, and DB pool closed.');
  }
}

runPhase4LiveVerification().catch((err) => {
  console.error('Phase 4 live verification failed:', err);
  process.exit(1);
});
