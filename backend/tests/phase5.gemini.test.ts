import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/database/pool.js';
import { getSharedRedisClient, closeRedis } from '../src/database/redis.js';
import { sha256Hex } from '../src/shared/crypto.js';
import { env } from '../src/config/env.js';
import {
  sanitizeTelemetryForAI,
  GeminiService,
} from '../src/modules/gemini/gemini.service.js';
import {
  incidentDiagnosisJoiSchema,
  endpointHealthReportJoiSchema,
  IncidentDiagnosis,
  EndpointHealthReport,
} from '../src/modules/gemini/gemini.schema.js';
import { RateLimitExceededError, AiServiceUnavailableError } from '../src/shared/errors.js';

describe('Phase 5 Google Gemini Integration & Unit Tests', () => {
  let backendServer: http.Server;
  let backendUrl: string;

  const tenantAKeyPlain = 'hf_live_p5_tenant_a_1234567890abcdef123456';
  let tenantAOrgId: string;

  const tenantBKeyPlain = 'hf_live_p5_tenant_b_9876543210fedcba987654';
  let tenantBOrgId: string;

  let tenantAEndpointId: string;
  let tenantADeliveryId: string;

  before(async () => {
    const keyAHash = sha256Hex(tenantAKeyPlain);
    const keyBHash = sha256Hex(tenantBKeyPlain);
    await pool.query(
      `DELETE FROM organizations WHERE id IN (
         SELECT organization_id FROM api_keys WHERE key_hash IN ($1, $2)
       );`,
      [keyAHash, keyBHash]
    );

    // 1. Setup Tenant A
    const orgResA = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Phase 5 Tenant A', 'p5-tenant-a-${Date.now()}', 'active')
       RETURNING id;`
    );
    tenantAOrgId = orgResA.rows[0]!.id;

    await pool.query(
      `INSERT INTO api_keys (organization_id, name, key_hash, key_prefix, scopes)
       VALUES ($1, 'Test A Key', $2, 'hf_live', ARRAY['*']);`,
      [tenantAOrgId, keyAHash]
    );

    // 2. Setup Tenant B
    const orgResB = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Phase 5 Tenant B', 'p5-tenant-b-${Date.now()}', 'active')
       RETURNING id;`
    );
    tenantBOrgId = orgResB.rows[0]!.id;

    await pool.query(
      `INSERT INTO api_keys (organization_id, name, key_hash, key_prefix, scopes)
       VALUES ($1, 'Test B Key', $2, 'hf_live', ARRAY['*']);`,
      [tenantBOrgId, keyBHash]
    );

    // 3. Create Tenant A Endpoint
    const epRes = await pool.query<{ id: string }>(
      `INSERT INTO endpoints (organization_id, name, url, secret, status)
       VALUES ($1, 'Payments Webhook', 'https://api.merchant.com/webhook', 'hf_sec_1234567890abcdef', 'active')
       RETURNING id;`,
      [tenantAOrgId]
    );
    tenantAEndpointId = epRes.rows[0]!.id;

    // 4. Create Circuit Breaker row
    await pool.query(
      `INSERT INTO endpoint_circuit_breakers (endpoint_id, organization_id, state, failure_count)
       VALUES ($1, $2, 'open', 5)
       ON CONFLICT (endpoint_id) DO UPDATE SET state = 'open', failure_count = 5;`,
      [tenantAEndpointId, tenantAOrgId]
    );

    // 5. Ingest Webhook Event & Delivery for Tenant A
    const evRes = await pool.query<{ id: string }>(
      `INSERT INTO webhook_events (organization_id, event_type, payload, idempotency_key)
       VALUES ($1, 'invoice.payment_failed', '{"invoice_id": "inv_123", "amount": 9900}'::jsonb, 'dedupe-p5-1')
       RETURNING id;`,
      [tenantAOrgId]
    );
    const eventId = evRes.rows[0]!.id;

    const delRes = await pool.query<{ id: string }>(
      `INSERT INTO deliveries (
         organization_id, webhook_event_id, endpoint_id, status, attempt_count, max_attempts,
         last_http_status, last_failure_class
       )
       VALUES ($1, $2, $3, 'dead_lettered', 3, 3, 500, 'http_5xx')
       RETURNING id;`,
      [tenantAOrgId, eventId, tenantAEndpointId]
    );
    tenantADeliveryId = delRes.rows[0]!.id;

    // Record delivery attempts
    await pool.query(
      `INSERT INTO delivery_attempts (
         delivery_id, attempt_number, status_code, outcome, failure_class, latency_ms,
         response_excerpt, error_message
       )
       VALUES
         ($1, 1, 500, 'failure', 'http_5xx', 340, 'Internal Server Error: DB connection pool exhausted', 'HTTP 500'),
         ($1, 2, 503, 'failure', 'http_5xx', 510, 'Service Unavailable', 'HTTP 503'),
         ($1, 3, 500, 'failure', 'http_5xx', 420, 'Internal Server Error: DB connection pool exhausted', 'HTTP 500');`,
      [tenantADeliveryId]
    );

    // Dead letter entry
    await pool.query(
      `INSERT INTO dead_letter_entries (
         organization_id, delivery_id, endpoint_id, webhook_event_id,
         reason, payload, last_status_code, classified_at, created_at
       )
       VALUES ($1, $2, $3, $4, 'Max retry attempts exhausted with persistent 5xx server errors', '{"invoice_id": "inv_123"}'::jsonb, 500, NOW(), NOW());`,
      [tenantAOrgId, tenantADeliveryId, tenantAEndpointId, eventId]
    );

    // Start HTTP backend server on ephemeral port
    backendServer = http.createServer(app);
    await new Promise<void>((resolve) => backendServer.listen(0, resolve));
    const port = (backendServer.address() as { port: number }).port;
    backendUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    // Clean up test data
    if (tenantAOrgId || tenantBOrgId) {
      await pool.query('DELETE FROM organizations WHERE id IN ($1, $2);', [
        tenantAOrgId || '00000000-0000-0000-0000-000000000000',
        tenantBOrgId || '00000000-0000-0000-0000-000000000000',
      ]);
    }
    if (backendServer) {
      backendServer.closeAllConnections?.();
      await new Promise<void>((resolve) => backendServer.close(() => resolve()));
    }
    await closeRedis();
    await closePool();
    setTimeout(() => process.exit(0), 100).unref();
  });

  // ==========================================
  // 1. UNIT TESTS: TELEMETRY SANITIZATION
  // ==========================================
  describe('Unit: sanitizeTelemetryForAI', () => {
    it('should mask sensitive credential keys and strip sensitive headers', () => {
      const rawTelemetry = {
        secret_key: 'sk_live_1234567890',
        api_token: 'secret_token_abc',
        nested: {
          user_password: 'super_secret_password',
          authToken: 'Bearer jwt.token.here',
          ssn: '123-45-6789',
          card_number: '4111111111111111',
          cvv: '123',
          normal_field: 'ok_to_send',
          nested_count: 42,
        },
        headers: {
          authorization: 'Bearer sensitive-token',
          'x-hookforge-signature': 't=123,v1=hex',
          'x-test-secret': 'supersecret',
          'content-type': 'application/json',
          'user-agent': 'HookForge-Delivery/1.0',
        },
      };

      const sanitized = sanitizeTelemetryForAI(rawTelemetry) as any;

      assert.strictEqual(sanitized.secret_key, '[REDACTED]');
      assert.strictEqual(sanitized.api_token, '[REDACTED]');
      assert.strictEqual(sanitized.nested.user_password, '[REDACTED]');
      assert.strictEqual(sanitized.nested.authToken, '[REDACTED]');
      assert.strictEqual(sanitized.nested.ssn, '[REDACTED]');
      assert.strictEqual(sanitized.nested.card_number, '[REDACTED]');
      assert.strictEqual(sanitized.nested.cvv, '[REDACTED]');
      assert.strictEqual(sanitized.nested.normal_field, 'ok_to_send');
      assert.strictEqual(sanitized.nested.nested_count, 42);

      assert.strictEqual(sanitized.headers.authorization, '[REDACTED]');
      assert.strictEqual(sanitized.headers['x-hookforge-signature'], '[REDACTED]');
      assert.strictEqual(sanitized.headers['x-test-secret'], '[REDACTED]');
      assert.strictEqual(sanitized.headers['content-type'], 'application/json');
      assert.strictEqual(sanitized.headers['user-agent'], 'HookForge-Delivery/1.0');
    });

    it('should truncate strings exceeding 1,024 characters', () => {
      const longString = 'X'.repeat(1500);
      const sanitized = sanitizeTelemetryForAI({ payload: longString }) as any;

      assert.strictEqual(sanitized.payload.length, 1024 + '... [TRUNCATED]'.length);
      assert.ok(sanitized.payload.endsWith('... [TRUNCATED]'));
    });

    it('should safely handle primitives, nulls, and arrays', () => {
      assert.strictEqual(sanitizeTelemetryForAI(null), null);
      assert.strictEqual(sanitizeTelemetryForAI(undefined), undefined);
      assert.strictEqual(sanitizeTelemetryForAI(12345), 12345);
      assert.strictEqual(sanitizeTelemetryForAI(true), true);

      const arr = ['normal', { api_key: 'top_secret' }, 99];
      const sanitizedArr = sanitizeTelemetryForAI(arr) as any[];
      assert.strictEqual(sanitizedArr[0], 'normal');
      assert.strictEqual(sanitizedArr[1].api_key, '[REDACTED]');
      assert.strictEqual(sanitizedArr[2], 99);
    });
  });

  // ==========================================
  // 2. UNIT TESTS: JOI SCHEMA VALIDATION
  // ==========================================
  describe('Unit: Joi Schemas for Gemini Structured Outputs', () => {
    it('should validate a valid IncidentDiagnosis object', () => {
      const validDiagnosis: IncidentDiagnosis = {
        incident_title: 'Persistent 500 Database Connection Failures',
        fault_domain: 'merchant_endpoint',
        severity: 'high',
        confidence: 'high',
        root_cause_explanation:
          'Destination server responded with HTTP 500 and response excerpt indicated pool exhaustion.',
        ambiguous_delivery_warning: false,
        recommended_operator_actions: [
          'Advise merchant to inspect database connection pool limits',
          'Temporarily rate-limit deliveries to this endpoint',
        ],
        suggested_policy_adjustment: {
          attempt_timeout_ms: 15000,
          max_attempts: 4,
          max_in_flight: 5,
          rationale: 'Reduce concurrency to avoid overwhelming merchant backend',
        },
        merchant_issue_summary:
          'Your webhook receiver at api.merchant.com is failing with database connection exhaustion.',
      };

      const { error, value } = incidentDiagnosisJoiSchema.validate(validDiagnosis);
      assert.strictEqual(error, undefined);
      assert.strictEqual(value.fault_domain, 'merchant_endpoint');
    });

    it('should reject an invalid IncidentDiagnosis missing required fields', () => {
      const invalid = {
        incident_title: 'Incomplete Diagnosis',
        fault_domain: 'unknown_domain', // invalid enum
      };

      const { error } = incidentDiagnosisJoiSchema.validate(invalid);
      assert.ok(error);
      assert.ok(error.details.length > 0);
    });

    it('should validate a valid EndpointHealthReport object', () => {
      const validReport: EndpointHealthReport = {
        overall_health: 'degraded',
        summary: 'Endpoint is experiencing intermittent 5xx server errors and elevated latency.',
        observed_patterns: [
          '3 consecutive 500 failures during payment events',
          'Average latency increased to 450ms',
        ],
        recommended_actions: [
          'Review endpoint error logs for database timeouts',
          'Increase attempt timeout from 10s to 15s',
        ],
        suggested_policy: {
          attempt_timeout_ms: 12000,
          max_in_flight: 10,
          max_attempts: 4,
          rationale: 'Balance retry persistence with merchant load',
        },
      };

      const { error, value } = endpointHealthReportJoiSchema.validate(validReport);
      assert.strictEqual(error, undefined);
      assert.strictEqual(value.overall_health, 'degraded');
    });
  });

  // ==========================================
  // 3. INTEGRATION TESTS: AUTH & TENANT ISOLATION
  // ==========================================
  describe('Integration: Tenant Isolation & Validation Guards', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await fetch(`${backendUrl}/api/v1/deliveries/${tenantADeliveryId}/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.strictEqual(res.status, 401);
    });

    it('should return 400 for invalid delivery UUID', async () => {
      const res = await fetch(`${backendUrl}/api/v1/deliveries/not-a-uuid/diagnose`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantAKeyPlain}`,
          'Content-Type': 'application/json',
        },
      });
      assert.strictEqual(res.status, 400);
      const json = (await res.json()) as any;
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('should return 404 when Tenant B tries to diagnose Tenant A delivery', async () => {
      const res = await fetch(`${backendUrl}/api/v1/deliveries/${tenantADeliveryId}/diagnose`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantBKeyPlain}`,
          'Content-Type': 'application/json',
        },
      });
      assert.strictEqual(res.status, 404);
      const json = (await res.json()) as any;
      assert.strictEqual(json.error.code, 'NOT_FOUND');
    });

    it('should return 404 when Tenant B tries to get health report for Tenant A endpoint', async () => {
      const res = await fetch(`${backendUrl}/api/v1/endpoints/${tenantAEndpointId}/health-report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantBKeyPlain}`,
          'Content-Type': 'application/json',
        },
      });
      assert.strictEqual(res.status, 404);
      const json = (await res.json()) as any;
      assert.strictEqual(json.error.code, 'NOT_FOUND');
    });
  });

  // ==========================================
  // 4. INTEGRATION TESTS: CACHING & RATE LIMITING
  // ==========================================
  describe('Integration: Redis Caching & Rate Limiting', () => {
    it('should serve cached diagnosis without invoking upstream if present', async () => {
      const redis = getSharedRedisClient();
      const mockDiagnosis: IncidentDiagnosis = {
        incident_title: 'Cached Incident Diagnosis',
        fault_domain: 'merchant_endpoint',
        severity: 'medium',
        confidence: 'high',
        root_cause_explanation: 'Cached explanation for unit testing.',
        ambiguous_delivery_warning: false,
        recommended_operator_actions: ['Inspect cached telemetry'],
        merchant_issue_summary: 'Cached merchant notification',
      };

      // Query delivery attempt count to construct key
      const del = await pool.query<{ attempt_count: number }>(
        'SELECT attempt_count FROM deliveries WHERE id = $1',
        [tenantADeliveryId]
      );
      const cacheKey = `diag:${tenantADeliveryId}:${del.rows[0]!.attempt_count}`;
      await redis.set(cacheKey, JSON.stringify(mockDiagnosis), 'EX', 600);

      const res = await fetch(`${backendUrl}/api/v1/deliveries/${tenantADeliveryId}/diagnose`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantAKeyPlain}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force_refresh: false }),
      });

      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as IncidentDiagnosis;
      assert.strictEqual(body.incident_title, 'Cached Incident Diagnosis');
      assert.strictEqual(body.fault_domain, 'merchant_endpoint');
    });

    it('should enforce per-organization rate limiting (max 20 req/min)', async () => {
      const redis = getSharedRedisClient();
      const currentMinute = Math.floor(Date.now() / 60000);
      const rateKey = `gemini:rate:${tenantAOrgId}:${currentMinute}`;

      // Artificially max out the counter
      await redis.set(rateKey, '20');

      const res = await fetch(`${backendUrl}/api/v1/deliveries/${tenantADeliveryId}/diagnose`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantAKeyPlain}`,
          'Content-Type': 'application/json',
        },
      });

      assert.strictEqual(res.status, 429);
      const json = (await res.json()) as any;
      assert.strictEqual(json.error.code, 'RATE_LIMIT_EXCEEDED');

      // Reset rate limit key for subsequent tests
      await redis.del(rateKey);
    });
  });

  // ==========================================
  // 5. LIVE GOOGLE GEMINI EXECUTION
  // ==========================================
  describe('Live Google Gemini Integration (@google/genai)', () => {
    it(
      'should successfully diagnose dead-letter delivery via live Gemini if API key is present and RUN_LIVE_GEMINI_TESTS=true',
      { timeout: 60000 },
      async (t) => {
        // Guard live API execution behind RUN_LIVE_GEMINI_TESTS=true to preserve the 20 requests/day Free Tier quota
        if (process.env.RUN_LIVE_GEMINI_TESTS !== 'true') {
          t.skip('Skipped live Gemini upstream test to preserve 20 req/day quota (set RUN_LIVE_GEMINI_TESTS=true to run)');
          return;
        }

        if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim() === '') {
          // If key not configured, verify 503 response
          const res = await fetch(`${backendUrl}/api/v1/deliveries/${tenantADeliveryId}/diagnose`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tenantAKeyPlain}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ force_refresh: true }),
          });
          assert.strictEqual(res.status, 503);
          const json = (await res.json()) as any;
          assert.strictEqual(json.error.code, 'AI_DIAGNOSIS_UNAVAILABLE');
          return;
        }

        // Live Gemini call
        const res = await fetch(`${backendUrl}/api/v1/deliveries/${tenantADeliveryId}/diagnose`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tenantAKeyPlain}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ force_refresh: true }),
        });

        assert.ok([200, 503].includes(res.status));
        if (res.status === 200) {
          const diagnosis = (await res.json()) as IncidentDiagnosis;
          const { error } = incidentDiagnosisJoiSchema.validate(diagnosis);
          assert.strictEqual(error, undefined);
          assert.ok(diagnosis.incident_title.length > 0);
          assert.ok(
            [
              'merchant_endpoint',
              'network_or_timeout',
              'endpoint_configuration',
              'security_policy',
              'rate_limiting',
            ].includes(diagnosis.fault_domain)
          );
          assert.ok(['low', 'medium', 'high', 'critical'].includes(diagnosis.severity));
          assert.ok(Array.isArray(diagnosis.recommended_operator_actions));
          assert.ok(diagnosis.recommended_operator_actions.length > 0);
          assert.ok(diagnosis.root_cause_explanation.length > 0);
          assert.ok(diagnosis.merchant_issue_summary.length > 0);
        } else {
          const json = (await res.json()) as any;
          assert.strictEqual(json.error.code, 'AI_DIAGNOSIS_UNAVAILABLE');
        }
      }
    );

    it(
      'should successfully generate endpoint health report via live Gemini if API key is present and RUN_LIVE_GEMINI_TESTS=true',
      { timeout: 60000 },
      async (t) => {
        // Guard live API execution behind RUN_LIVE_GEMINI_TESTS=true to preserve the 20 requests/day Free Tier quota
        if (process.env.RUN_LIVE_GEMINI_TESTS !== 'true') {
          t.skip('Skipped live Gemini upstream test to preserve 20 req/day quota (set RUN_LIVE_GEMINI_TESTS=true to run)');
          return;
        }

        if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim() === '') {
          const res = await fetch(`${backendUrl}/api/v1/endpoints/${tenantAEndpointId}/health-report`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tenantAKeyPlain}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ force_refresh: true }),
          });
          assert.strictEqual(res.status, 503);
          const json = (await res.json()) as any;
          assert.strictEqual(json.error.code, 'AI_DIAGNOSIS_UNAVAILABLE');
          return;
        }

        // Live Gemini call
        const res = await fetch(`${backendUrl}/api/v1/endpoints/${tenantAEndpointId}/health-report`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tenantAKeyPlain}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ force_refresh: true }),
        });

        assert.ok([200, 503].includes(res.status));

        if (res.status === 200) {
          const report = (await res.json()) as EndpointHealthReport;
          const { error } = endpointHealthReportJoiSchema.validate(report);
          assert.strictEqual(error, undefined);
          assert.ok(['healthy', 'degraded', 'critical'].includes(report.overall_health));
          assert.ok(report.summary.length > 0);
          assert.ok(Array.isArray(report.observed_patterns));
          assert.ok(Array.isArray(report.recommended_actions));
        } else {
          const json = (await res.json()) as any;
          assert.strictEqual(json.error.code, 'AI_DIAGNOSIS_UNAVAILABLE');
        }
      }
    );
  });
});
