import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { validateEnv } from '../src/config/env.js';
import {
  pool,
  withTransaction,
  closePool,
  buildPgPoolConfig,
  isTransientConnectionError,
} from '../src/database/pool.js';
import { getRedisConnectionOptions } from '../src/database/redis.js';
import { runMigrations } from '../src/database/migrate.js';
import { app, getAllowedCorsOrigins } from '../src/app.js';

describe('Phase 1 Foundation and Infrastructure Tests', () => {
  let server: http.Server;
  let testPort: number;

  before(async () => {
    // Start test server on ephemeral port
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          testPort = addr.port;
        }
        resolve();
      });
    });
  });

  after(async () => {
    server?.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await closePool();
  });

  describe('1. Environment Configuration Validation', () => {
    it('should validate valid environment configuration successfully', () => {
      const validConfig = {
        NODE_ENV: 'test',
        PORT: '4000',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/hookforge',
        DATABASE_POOL_MAX: '10',
        REDIS_URL: 'redis://localhost:6379',
        HMAC_MASTER_KEY: '0123456789abcdef0123456789abcdef',
        GEMINI_API_KEY: 'test_key',
        GEMINI_MODEL: 'gemini-3.5-flash-lite',
        LOG_LEVEL: 'silent',
      };

      const parsed = validateEnv(validConfig);
      assert.equal(parsed.NODE_ENV, 'test');
      assert.equal(parsed.PORT, 4000);
      assert.equal(parsed.DATABASE_POOL_MAX, 10);
      assert.equal(parsed.DATABASE_CONNECTION_TIMEOUT_MS, 30000);
      assert.equal(parsed.HMAC_MASTER_KEY, '0123456789abcdef0123456789abcdef');
    });

    it('should fail fast when required environment variables are missing', () => {
      const invalidConfig = {
        NODE_ENV: 'development',
      };

      assert.throws(
        () => validateEnv(invalidConfig),
        /Environment validation failed/
      );
    });

    it('should reject invalid DATABASE_URL scheme', () => {
      const invalidConfig = {
        DATABASE_URL: 'mysql://root:root@localhost:3306/db',
        REDIS_URL: 'redis://localhost:6379',
        HMAC_MASTER_KEY: '0123456789abcdef0123456789abcdef',
        GEMINI_API_KEY: 'test',
      };

      assert.throws(
        () => validateEnv(invalidConfig),
        /DATABASE_URL must be a valid PostgreSQL connection URI/
      );
    });
  });

  describe('1b. Cloud DB, Redis TLS & CORS Config Helpers', () => {
    it('should keep local Docker PostgreSQL non-SSL with 30s timeout and keepAlive', () => {
      const cfg = buildPgPoolConfig({
        databaseUrl: 'postgresql://postgres:postgres@localhost:5433/hookforge',
      });

      assert.equal(cfg.ssl, undefined);
      assert.equal(cfg.enableChannelBinding, undefined);
      assert.equal(cfg.connectionTimeoutMillis, 30000);
      assert.equal(cfg.keepAlive, true);
      assert.equal(cfg.keepAliveInitialDelayMillis, 10000);
    });

    it('should configure TLS, channel binding, and timeout for Neon URLs cleanly', () => {
      const cfg = buildPgPoolConfig({
        databaseUrl:
          'postgresql://neondb_owner:secret@ep-cool-rain-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      });

      assert.deepEqual(cfg.ssl, { rejectUnauthorized: true });
      assert.equal(cfg.enableChannelBinding, true);
      assert.equal(cfg.connectionTimeoutMillis, 30000);
      assert.equal(
        cfg.connectionString,
        'postgresql://neondb_owner:secret@ep-cool-rain-123456-pooler.us-east-2.aws.neon.tech/neondb'
      );
    });

    it('should auto-enable TLS for .neon.tech hosts even when sslmode is omitted', () => {
      const cfg = buildPgPoolConfig({
        databaseUrl: 'postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/neondb',
      });

      assert.deepEqual(cfg.ssl, { rejectUnauthorized: true });
    });

    it('should honor uselibpqcompat=true, sslmode=disable, and direct sslnegotiation overrides', () => {
      const compatCfg = buildPgPoolConfig({
        databaseUrl: 'postgresql://user:pass@db.example.com/app?uselibpqcompat=true&sslmode=require',
      });
      assert.deepEqual(compatCfg.ssl, { rejectUnauthorized: false });

      const disabledCfg = buildPgPoolConfig({
        databaseUrl: 'postgresql://user:pass@localhost:5432/app?sslmode=disable',
      });
      assert.equal(disabledCfg.ssl, false);

      const directCfg = buildPgPoolConfig({
        databaseUrl: 'postgresql://user:pass@ep-test.neon.tech/neondb?sslmode=require&sslnegotiation=direct',
        sslRejectUnauthorized: false,
      });
      assert.deepEqual(directCfg.ssl, { rejectUnauthorized: false });
      assert.equal(directCfg.sslnegotiation, 'direct');
    });

    it('should detect transient cold-start and timeout connection errors accurately', () => {
      const wrappedTimeoutErr = new Error('Connection terminated due to connection timeout', {
        cause: new Error('Connection terminated unexpectedly'),
      });
      assert.equal(isTransientConnectionError(wrappedTimeoutErr), true);

      const startupCodeErr = Object.assign(new Error('sorry, too late'), { code: '57P03' });
      assert.equal(isTransientConnectionError(startupCodeErr), true);

      const authErr = Object.assign(new Error('password authentication failed'), { code: '28P01' });
      assert.equal(isTransientConnectionError(authErr), false);
    });

    it('should parse Redis connection options for both local redis:// and TLS rediss:// URLs', () => {
      const localOpts = getRedisConnectionOptions('redis://localhost:6379');
      assert.equal(localOpts.host, 'localhost');
      assert.equal(localOpts.port, 6379);
      assert.equal(localOpts.tls, undefined);
      assert.equal(localOpts.maxRetriesPerRequest, null);

      const tlsOpts = getRedisConnectionOptions(
        'rediss://default:secret_token@shining-raptor-195541.upstash.io:6379'
      );
      assert.equal(tlsOpts.host, 'shining-raptor-195541.upstash.io');
      assert.equal(tlsOpts.port, 6379);
      assert.equal(tlsOpts.username, 'default');
      assert.equal(tlsOpts.password, 'secret_token');
      assert.deepEqual(tlsOpts.tls, { servername: 'shining-raptor-195541.upstash.io' });
    });

    it('should build allowed CORS origins including Vercel deployment, custom env, and localhost', () => {
      const origins = getAllowedCorsOrigins(
        'https://custom-admin.example.com/',
        'https://preview.example.com'
      );
      assert.ok(origins.has('https://ai-vibeathon.vercel.app'));
      assert.ok(origins.has('http://localhost:5173'));
      assert.ok(origins.has('https://custom-admin.example.com'));
      assert.ok(origins.has('https://preview.example.com'));
    });
  });

  describe('2. Idempotent Database Migrations', () => {
    it('should run migrations idempotently without failure', async () => {
      const firstRun = await runMigrations();
      assert.ok(Array.isArray(firstRun), 'First run should return applied array');

      // Second run must be idempotent and return 0 newly applied files
      const secondRun = await runMigrations();
      assert.equal(secondRun.length, 0, 'Second run should not reapply already executed migrations');
    });

    it('should have created all 10 required MVP tables', async () => {
      const expectedTables = [
        'organizations',
        'api_keys',
        'endpoints',
        'event_subscriptions',
        'webhook_events',
        'deliveries',
        'delivery_attempts',
        'outbox_events',
        'endpoint_circuit_breakers',
        'dead_letter_entries',
      ];

      const res = await pool.query<{ table_name: string }>(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
      `);

      const actualTables = new Set(res.rows.map((r) => r.table_name));

      for (const table of expectedTables) {
        assert.ok(actualTables.has(table), `Table ${table} should exist in PostgreSQL schema`);
      }
    });
  });

  describe('3. Transaction Helper (withTransaction) Commit & Rollback', () => {
    it('should commit transaction successfully when no error is thrown', async () => {
      const testSlug = `test-org-commit-${Date.now()}`;

      const insertedOrg = await withTransaction(async (client) => {
        const res = await client.query<{ id: string; slug: string }>(
          `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, slug;`,
          ['Transaction Test Org', testSlug]
        );
        return res.rows[0];
      });

      assert.ok(insertedOrg?.id);

      // Verify row exists outside transaction
      const verifyRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM organizations WHERE slug = $1;`,
        [testSlug]
      );
      assert.equal(parseInt(verifyRes.rows[0]!.count, 10), 1);

      // Clean up
      await pool.query(`DELETE FROM organizations WHERE slug = $1;`, [testSlug]);
    });

    it('should rollback transaction completely when an error occurs', async () => {
      const testSlug = `test-org-rollback-${Date.now()}`;

      await assert.rejects(async () => {
        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO organizations (name, slug) VALUES ($1, $2);`,
            ['Rollback Org', testSlug]
          );
          throw new Error('Simulated failure inside transaction');
        });
      }, /Simulated failure inside transaction/);

      // Verify row does NOT exist in database
      const verifyRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM organizations WHERE slug = $1;`,
        [testSlug]
      );
      assert.equal(parseInt(verifyRes.rows[0]!.count, 10), 0);
    });
  });

  describe('4. Health Check & CORS Preflight Endpoints', () => {
    it('GET /health/live should return 200 with process liveness status', async () => {
      const response = await fetch(`http://localhost:${testPort}/health/live`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as { status: string; uptime: number };
      assert.equal(body.status, 'ok');
      assert.ok(typeof body.uptime === 'number');
    });

    it('GET /health/ready should return 200 when PostgreSQL and Redis are connected', async () => {
      const response = await fetch(`http://localhost:${testPort}/health/ready`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        status: string;
        services: { postgres: string; redis: string };
      };

      assert.equal(body.status, 'ok');
      assert.equal(body.services.postgres, 'up');
      assert.equal(body.services.redis, 'up');
    });

    it('OPTIONS preflight should allow https://ai-vibeathon.vercel.app and custom headers', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/v1/events`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://ai-vibeathon.vercel.app',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization, Content-Type, Idempotency-Key',
        },
      });

      assert.equal(response.status, 204);
      assert.equal(
        response.headers.get('access-control-allow-origin'),
        'https://ai-vibeathon.vercel.app'
      );
      const allowMethods = response.headers.get('access-control-allow-methods') || '';
      assert.ok(allowMethods.includes('GET'));
      assert.ok(allowMethods.includes('POST'));
      assert.ok(allowMethods.includes('PATCH'));
      assert.ok(allowMethods.includes('DELETE'));
      assert.ok(allowMethods.includes('OPTIONS'));

      const allowHeaders = response.headers.get('access-control-allow-headers') || '';
      assert.ok(allowHeaders.includes('Authorization'));
      assert.ok(allowHeaders.includes('Idempotency-Key'));
    });
  });
});
