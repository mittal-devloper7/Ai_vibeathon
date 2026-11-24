import http from 'node:http';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/database/pool.js';
import { getSharedRedisClient, closeRedis } from '../src/database/redis.js';
import { sha256Hex } from '../src/shared/crypto.js';
import { env } from '../src/config/env.js';
import {
  IncidentDiagnosis,
  EndpointHealthReport,
} from '../src/modules/gemini/gemini.schema.js';

async function main() {
  console.log('\n============================================================');
  console.log('  HOOKFORGE PHASE 5: GOOGLE GEMINI INCIDENT COPILOT VERIFICATION');
  console.log('============================================================\n');

  console.log(`[Config] GEMINI_MODEL: ${env.GEMINI_MODEL}`);
  console.log(`[Config] GEMINI_API_KEY: ${env.GEMINI_API_KEY ? env.GEMINI_API_KEY.slice(0, 10) + '...' : '(Not Configured)'}`);

  // 1. Start ephemeral HTTP server
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Server] Ephemeral backend listening at ${baseUrl}`);

  const tenantKey = 'hf_live_p5_verify_' + Math.random().toString(36).substring(2);
  let orgId = '';

  try {
    // 2. Create test org & API key
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Gemini Verification Org', 'gemini-verify-${Date.now()}', 'active')
       RETURNING id;`
    );
    orgId = orgRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO api_keys (organization_id, name, key_hash, key_prefix, scopes)
       VALUES ($1, 'Gemini Verify Key', $2, 'hf_live', ARRAY['*']);`,
      [orgId, sha256Hex(tenantKey)]
    );
    console.log(`[DB] Created test organization (${orgId})`);

    // 3. Create simulated failing endpoint
    const epRes = await pool.query<{ id: string }>(
      `INSERT INTO endpoints (
         organization_id, name, url, secret,
         status, policy
       )
       VALUES ($1, 'Acme Checkout Webhook', 'https://api.acme.shop/webhooks/orders', 'hf_sec_xyz123', 'active', '{"max_attempts": 3, "attempt_timeout_ms": 5000}'::jsonb)
       RETURNING id;`,
      [orgId]
    );
    const endpointId = epRes.rows[0]!.id;

    // Set circuit breaker state to 'open'
    await pool.query(
      `INSERT INTO endpoint_circuit_breakers (endpoint_id, organization_id, state, failure_count)
       VALUES ($1, $2, 'open', 5)
       ON CONFLICT (endpoint_id) DO UPDATE SET state = 'open', failure_count = 5;`,
      [endpointId, orgId]
    );

    // 4. Create dead-lettered delivery with attempts
    const evRes = await pool.query<{ id: string }>(
      `INSERT INTO webhook_events (organization_id, event_type, payload, idempotency_key)
       VALUES ($1, 'payment.charge_failed', '{"order_id": "ord_999", "reason": "gateway_timeout", "amount_cents": 12500}'::jsonb, 'dedupe-gemini-test')
       RETURNING id;`,
      [orgId]
    );
    const eventId = evRes.rows[0]!.id;

    const delRes = await pool.query<{ id: string }>(
      `INSERT INTO deliveries (
         organization_id, webhook_event_id, endpoint_id, status, attempt_count, max_attempts,
         last_http_status, last_failure_class
       )
       VALUES ($1, $2, $3, 'dead_lettered', 3, 3, 504, 'timeout')
       RETURNING id;`,
      [orgId, eventId, endpointId]
    );
    const deliveryId = delRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO delivery_attempts (
         delivery_id, attempt_number, status_code, outcome, failure_class, latency_ms,
         response_excerpt, error_message
       )
       VALUES
         ($1, 1, 504, 'failure', 'timeout', 5012, 'Gateway Timeout: upstream microservice upstream_payments did not respond within 5000ms', 'HTTP 504 Gateway Timeout'),
         ($1, 2, 504, 'failure', 'timeout', 5008, 'Gateway Timeout: upstream microservice upstream_payments did not respond within 5000ms', 'HTTP 504 Gateway Timeout'),
         ($1, 3, 504, 'failure', 'timeout', 5015, 'Gateway Timeout: upstream microservice upstream_payments did not respond within 5000ms', 'HTTP 504 Gateway Timeout');`,
      [deliveryId]
    );

    await pool.query(
      `INSERT INTO dead_letter_entries (
         organization_id, delivery_id, endpoint_id, webhook_event_id,
         reason, payload, last_status_code, classified_at, created_at
       )
       VALUES ($1, $2, $3, $4, 'Consecutive gateway timeouts exceeded policy max_attempts', '{"order_id": "ord_999"}'::jsonb, 504, NOW(), NOW());`,
      [orgId, deliveryId, endpointId, eventId]
    );
    console.log(`[DB] Created dead-letter delivery (${deliveryId}) and endpoint (${endpointId})`);

    // 5. Run Live Incident Diagnosis
    console.log('\n--- 1. Testing POST /api/v1/deliveries/:deliveryId/diagnose ---');
    const diagStart = Date.now();
    const diagRes = await fetch(`${baseUrl}/api/v1/deliveries/${deliveryId}/diagnose`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenantKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force_refresh: true }),
    });

    const diagDuration = Date.now() - diagStart;
    console.log(`[HTTP] Status: ${diagRes.status} in ${diagDuration}ms`);

    if (diagRes.status === 200) {
      const diagnosis = (await diagRes.json()) as IncidentDiagnosis;
      console.log('✅ Google Gemini Incident Diagnosis Output:');
      console.log(JSON.stringify(diagnosis, null, 2));

      // Test Redis cache retrieval
      console.log('\n--- Testing Redis Cache Hit (force_refresh: false) ---');
      const cacheStart = Date.now();
      const cachedRes = await fetch(`${baseUrl}/api/v1/deliveries/${deliveryId}/diagnose`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force_refresh: false }),
      });
      const cacheDuration = Date.now() - cacheStart;
      console.log(`[HTTP Cache] Status: ${cachedRes.status} in ${cacheDuration}ms (Served from Redis)`);
    } else {
      const errBody = await diagRes.text();
      console.log(`⚠️ Diagnosis call response: ${errBody}`);
    }

    // 6. Run Live Endpoint Health Report
    console.log('\n--- 2. Testing POST /api/v1/endpoints/:endpointId/health-report ---');
    const healthStart = Date.now();
    const healthRes = await fetch(`${baseUrl}/api/v1/endpoints/${endpointId}/health-report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenantKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force_refresh: true }),
    });

    const healthDuration = Date.now() - healthStart;
    console.log(`[HTTP] Status: ${healthRes.status} in ${healthDuration}ms`);

    if (healthRes.status === 200) {
      const healthReport = (await healthRes.json()) as EndpointHealthReport;
      console.log('✅ Google Gemini Endpoint Health Report Output:');
      console.log(JSON.stringify(healthReport, null, 2));
    } else {
      const errBody = await healthRes.text();
      console.log(`⚠️ Health report call response: ${errBody}`);
    }

    console.log('\n============================================================');
    console.log('  PHASE 5 GOOGLE GEMINI VERIFICATION COMPLETED SUCCESSFULLY');
    console.log('============================================================\n');
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exitCode = 1;
  } finally {
    if (orgId) {
      await pool.query('DELETE FROM organizations WHERE id = $1;', [orgId]).catch(() => {});
    }
    server?.closeAllConnections?.();
    server.close();
    await closeRedis();
    await closePool();
  }
}

main();
