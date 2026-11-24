import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/database/pool.js';
import { sha256Hex } from '../src/shared/crypto.js';

describe('Phase 2 Core Backend Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  // Tenant A Credentials
  const tenantAKeyPlain = 'hf_live_tenant_a_1234567890abcdef12345678';
  let tenantAOrgId: string;
  let tenantAApiKeyId: string;

  // Tenant B Credentials (for cross-tenant testing)
  const tenantBKeyPlain = 'hf_live_tenant_b_1234567890abcdef12345678';
  let tenantBOrgId: string;

  // Revoked API Key
  const revokedKeyPlain = 'hf_live_revoked_1234567890abcdef12345678';

  before(async () => {
    // Start ephemeral server
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // 1. Setup Tenant A
    const orgARes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Tenant A Org', 'tenant-a-${Date.now()}', 'active')
       RETURNING id;`
    );
    tenantAOrgId = orgARes.rows[0]!.id;

    const keyAHash = sha256Hex(tenantAKeyPlain);
    const keyARes = await pool.query<{ id: string }>(
      `INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, scopes)
       VALUES ($1, $2, 'hf_live_tenant_a', 'Tenant A Live Key', '{"*"}')
       RETURNING id;`,
      [tenantAOrgId, keyAHash]
    );
    tenantAApiKeyId = keyARes.rows[0]!.id;

    // 2. Setup Tenant B
    const orgBRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Tenant B Org', 'tenant-b-${Date.now()}', 'active')
       RETURNING id;`
    );
    tenantBOrgId = orgBRes.rows[0]!.id;

    const keyBHash = sha256Hex(tenantBKeyPlain);
    await pool.query(
      `INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, scopes)
       VALUES ($1, $2, 'hf_live_tenant_b', 'Tenant B Live Key', '{"*"}');`,
      [tenantBOrgId, keyBHash]
    );

    // 3. Setup Revoked Key
    const revokedKeyHash = sha256Hex(revokedKeyPlain);
    await pool.query(
      `INSERT INTO api_keys (organization_id, key_hash, key_prefix, name, revoked_at)
       VALUES ($1, $2, 'hf_live_revoked', 'Revoked Key', NOW());`,
      [tenantAOrgId, revokedKeyHash]
    );
  });

  after(async () => {
    // Cleanup created test orgs
    if (tenantAOrgId) {
      await pool.query('DELETE FROM organizations WHERE id = $1', [tenantAOrgId]);
    }
    if (tenantBOrgId) {
      await pool.query('DELETE FROM organizations WHERE id = $1', [tenantBOrgId]);
    }

    server?.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await closePool();
  });

  describe('1. Authentication Middleware', () => {
    it('should reject requests without Authorization header with 401 UNAUTHENTICATED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`);
      assert.equal(res.status, 401);
      const body = await res.json() as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    });

    it('should reject malformed Authorization header with 401 UNAUTHENTICATED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      assert.equal(res.status, 401);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    });

    it('should reject unknown API key with 401 UNAUTHENTICATED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        headers: { Authorization: 'Bearer hf_live_unknown_key_999999999999' },
      });
      assert.equal(res.status, 401);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    });

    it('should reject revoked API key with 401 UNAUTHENTICATED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        headers: { Authorization: `Bearer ${revokedKeyPlain}` },
      });
      assert.equal(res.status, 401);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    });
  });

  describe('2. Joi Payload Validation Middleware', () => {
    it('should reject missing required fields with 400 VALIDATION_ERROR', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 400);
      const body = await res.json() as { error: { code: string; details: Array<{ field: string }> } };
      assert.equal(body.error.code, 'VALIDATION_ERROR');
      assert.ok(Array.isArray(body.error.details));
      const fields = body.error.details.map((d) => d.field);
      assert.ok(fields.includes('name'));
      assert.ok(fields.includes('url'));
      assert.ok(fields.includes('subscriptions'));
    });

    it('should reject unknown fields (allowUnknown: false) with 400 VALIDATION_ERROR', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Test Endpoint',
          url: 'https://example.com/webhook',
          subscriptions: ['payment.success'],
          unauthorized_extra_field: 'attack',
        }),
      });

      assert.equal(res.status, 400);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    });
  });

  describe('3. SSRF Guard Protection', () => {
    it('should reject loopback IP (127.0.0.1) with 422 POLICY_REJECTED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Loopback Target',
          url: 'https://127.0.0.1:8080/webhook',
          subscriptions: ['*'],
        }),
      });

      assert.equal(res.status, 422);
      const body = await res.json() as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'POLICY_REJECTED');
      assert.match(body.error.message, /forbidden internal or private IP address/i);
    });

    it('should reject RFC 1918 private IP (192.168.1.1) with 422 POLICY_REJECTED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Private Network Target',
          url: 'https://192.168.1.1/webhook',
          subscriptions: ['*'],
        }),
      });

      assert.equal(res.status, 422);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'POLICY_REJECTED');
    });

    it('should reject cloud metadata service (169.254.169.254) with 422 POLICY_REJECTED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Cloud Metadata Target',
          url: 'https://169.254.169.254/latest/meta-data',
          subscriptions: ['*'],
        }),
      });

      assert.equal(res.status, 422);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'POLICY_REJECTED');
    });

    it('should reject URL with embedded credentials with 422 POLICY_REJECTED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Credentials Target',
          url: 'https://admin:secret@example.com/webhook',
          subscriptions: ['*'],
        }),
      });

      assert.equal(res.status, 422);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'POLICY_REJECTED');
    });

    it('should reject URL with hash fragments with 422 POLICY_REJECTED', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Fragment Target',
          url: 'https://example.com/webhook#section1',
          subscriptions: ['*'],
        }),
      });

      assert.equal(res.status, 422);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'POLICY_REJECTED');
    });
  });

  describe('4. Endpoints Management & Secret Encryption', () => {
    let createdEndpointId: string;
    let initialSigningSecret: string;
    let initialKeyId: string;

    it('POST /api/v1/endpoints should create endpoint and return plaintext signing_secret', async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Production Webhook Endpoint',
          url: 'https://webhook.site/hookforge-test-target',
          description: 'Tenant A Primary Endpoint',
          subscriptions: ['payment.success', 'customer.created'],
          rate_limit_per_minute: 1200,
          policy: {
            max_attempts: 4,
            attempt_timeout_ms: 8000,
            max_in_flight: 15,
          },
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json() as {
        id: string;
        name: string;
        signing_secret: string;
        signing_key_id: string;
        circuit_breaker_state: string;
        subscriptions: string[];
      };

      assert.ok(data.id);
      assert.equal(data.name, 'Production Webhook Endpoint');
      assert.ok(data.signing_secret.startsWith('whsec_'));
      assert.ok(data.signing_key_id.startsWith('key_'));
      assert.equal(data.circuit_breaker_state, 'closed');
      assert.deepEqual(data.subscriptions.sort(), ['customer.created', 'payment.success']);

      createdEndpointId = data.id;
      initialSigningSecret = data.signing_secret;
      initialKeyId = data.signing_key_id;

      // Verify encrypted at rest in database
      const dbRes = await pool.query<{ secret: string; signing_key_id: string }>(
        'SELECT secret, signing_key_id FROM endpoints WHERE id = $1',
        [createdEndpointId]
      );
      assert.ok(dbRes.rows[0]!.secret.startsWith('v1:'), 'Secret must be stored in encrypted v1 AES-GCM format');
      assert.notEqual(dbRes.rows[0]!.secret, initialSigningSecret, 'Secret must never be stored as plaintext');
    });

    it('GET /api/v1/endpoints and GET /api/v1/endpoints/:id should NEVER leak secrets', async () => {
      // List
      const listRes = await fetch(`${baseUrl}/api/v1/endpoints`, {
        headers: { Authorization: `Bearer ${tenantAKeyPlain}` },
      });
      assert.equal(listRes.status, 200);
      const listData = await resJson(listRes) as { data: Array<Record<string, unknown>> };
      assert.ok(listData.data.length > 0);
      for (const ep of listData.data) {
        assert.equal(ep['signing_secret'], undefined, 'signing_secret must never be in list response');
        assert.equal(ep['secret'], undefined, 'secret must never be in list response');
      }

      // Single
      const singleRes = await fetch(`${baseUrl}/api/v1/endpoints/${createdEndpointId}`, {
        headers: { Authorization: `Bearer ${tenantAKeyPlain}` },
      });
      assert.equal(singleRes.status, 200);
      const singleData = await singleRes.json() as Record<string, unknown>;
      assert.equal(singleData['signing_secret'], undefined, 'signing_secret must never be in get response');
      assert.equal(singleData['secret'], undefined, 'secret must never be in get response');
    });

    it('PATCH /api/v1/endpoints/:id should update properties and subscriptions', async () => {
      const updateRes = await fetch(`${baseUrl}/api/v1/endpoints/${createdEndpointId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Renamed Endpoint',
          subscriptions: ['payment.*'],
        }),
      });

      assert.equal(updateRes.status, 200);
      const updated = await updateRes.json() as { name: string; subscriptions: string[] };
      assert.equal(updated.name, 'Renamed Endpoint');
      assert.deepEqual(updated.subscriptions, ['payment.*']);
    });

    it('POST /api/v1/endpoints/:id/rotate-secret should generate a new secret and key ID', async () => {
      const rotateRes = await fetch(`${baseUrl}/api/v1/endpoints/${createdEndpointId}/rotate-secret`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tenantAKeyPlain}` },
      });

      assert.equal(rotateRes.status, 200);
      const rotateData = await rotateRes.json() as {
        endpoint_id: string;
        signing_key_id: string;
        signing_secret: string;
      };

      assert.equal(rotateData.endpoint_id, createdEndpointId);
      assert.notEqual(rotateData.signing_secret, initialSigningSecret, 'New signing secret must differ from old');
      assert.notEqual(rotateData.signing_key_id, initialKeyId, 'New key ID must differ from old');
      assert.ok(rotateData.signing_secret.startsWith('whsec_'));
    });
  });

  describe('5. Event Ingestion, Idempotency & Outbox Transaction', () => {
    const idempotencyKey = `idemp_test_${Date.now()}`;
    const eventPayload = {
      type: 'payment.success',
      data: {
        order_id: 'ord_12345',
        amount: 2500,
        currency: 'USD',
      },
    };

    let firstEventId: string;

    it('POST /api/v1/events should ingest event, return 202, and create delivery & outbox entries', async () => {
      const res = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify(eventPayload),
      });

      assert.equal(res.status, 202);
      const data = await res.json() as {
        event_id: string;
        status: string;
        idempotent_replay: boolean;
        deliveries_created: number;
      };

      assert.ok(data.event_id);
      assert.equal(data.status, 'accepted');
      assert.equal(data.idempotent_replay, false);
      assert.ok(data.deliveries_created >= 1);

      firstEventId = data.event_id;

      // Verify Database State
      const eventDb = await pool.query<{ id: string; payload_sha256: string }>(
        'SELECT id, payload_sha256 FROM webhook_events WHERE id = $1',
        [firstEventId]
      );
      assert.equal(eventDb.rows.length, 1);
      assert.ok(eventDb.rows[0]!.payload_sha256);

      const deliveryDb = await pool.query<{ id: string }>(
        'SELECT id FROM deliveries WHERE webhook_event_id = $1',
        [firstEventId]
      );
      assert.ok(deliveryDb.rows.length >= 1);
      const deliveryId = deliveryDb.rows[0]!.id;

      const outboxDb = await pool.query<{ id: string; dedupe_key: string }>(
        'SELECT id, dedupe_key FROM outbox_events WHERE delivery_id = $1',
        [deliveryId]
      );
      assert.equal(outboxDb.rows.length, 1);
      assert.equal(outboxDb.rows[0]!.dedupe_key, `${deliveryId}:attempt_0`);
    });

    it('POST /api/v1/events with SAME idempotency key and SAME payload should replay without extra deliveries', async () => {
      const replayRes = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify(eventPayload),
      });

      assert.equal(replayRes.status, 202);
      const replayData = await replayRes.json() as {
        event_id: string;
        status: string;
        idempotent_replay: boolean;
        deliveries_created: number;
      };

      assert.equal(replayData.event_id, firstEventId, 'Must return the same event_id');
      assert.equal(replayData.idempotent_replay, true);
      assert.equal(replayData.deliveries_created, 0);

      // Verify no duplicate delivery rows exist in DB
      const countRes = await pool.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM deliveries WHERE webhook_event_id = $1',
        [firstEventId]
      );
      assert.equal(parseInt(countRes.rows[0]!.count, 10), 1);
    });

    it('POST /api/v1/events with SAME idempotency key but DIFFERENT payload should return 409 IDEMPOTENCY_CONFLICT', async () => {
      const conflictRes = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          type: 'payment.success',
          data: {
            order_id: 'ord_DIFFERENT_PAYLOAD',
            amount: 99999,
          },
        }),
      });

      assert.equal(conflictRes.status, 409);
      const conflictData = await conflictRes.json() as { error: { code: string } };
      assert.equal(conflictData.error.code, 'IDEMPOTENCY_CONFLICT');
    });

    it('GET /api/v1/events should return list of organization events', async () => {
      const listRes = await fetch(`${baseUrl}/api/v1/events`, {
        headers: { Authorization: `Bearer ${tenantAKeyPlain}` },
      });

      assert.equal(listRes.status, 200);
      const listData = await listRes.json() as { data: Array<{ id: string; event_type: string }> };
      assert.ok(Array.isArray(listData.data));
      assert.ok(listData.data.some((e) => e.id === firstEventId));
    });
  });

  describe('6. Multi-Tenant Isolation', () => {
    let tenantAEndpointId: string;

    before(async () => {
      // Create Tenant A endpoint
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantAKeyPlain}`,
        },
        body: JSON.stringify({
          name: 'Tenant A Secret Endpoint',
          url: 'https://webhook.site/tenant-a-test',
          subscriptions: ['order.*'],
        }),
      });
      const data = await res.json() as { id: string };
      tenantAEndpointId = data.id;
    });

    it("Tenant B should receive 404 NOT_FOUND when attempting to GET Tenant A's endpoint", async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints/${tenantAEndpointId}`, {
        headers: { Authorization: `Bearer ${tenantBKeyPlain}` },
      });
      assert.equal(res.status, 404);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'NOT_FOUND');
    });

    it("Tenant B should receive 404 NOT_FOUND when attempting to PATCH Tenant A's endpoint", async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints/${tenantAEndpointId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tenantBKeyPlain}`,
        },
        body: JSON.stringify({ name: 'Hacked by Tenant B' }),
      });
      assert.equal(res.status, 404);
    });

    it("Tenant B should receive 404 NOT_FOUND when attempting to rotate Tenant A's endpoint secret", async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints/${tenantAEndpointId}/rotate-secret`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tenantBKeyPlain}` },
      });
      assert.equal(res.status, 404);
    });

    it("Tenant B's GET /api/v1/endpoints should NOT include Tenant A's endpoint", async () => {
      const res = await fetch(`${baseUrl}/api/v1/endpoints`, {
        headers: { Authorization: `Bearer ${tenantBKeyPlain}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json() as { data: Array<{ id: string }> };
      assert.ok(!data.data.some((e) => e.id === tenantAEndpointId));
    });
  });
});

async function resJson(res: Response): Promise<unknown> {
  return res.json();
}
