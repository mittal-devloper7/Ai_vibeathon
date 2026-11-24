import crypto from 'node:crypto';
import { pool, waitForDatabaseReady, withTransaction } from './pool.js';
import { logger } from '../shared/logger.js';

export async function runSeed(): Promise<void> {
  logger.info('Starting idempotent database seeder...');

  await waitForDatabaseReady();

  const orgSlug = 'acme-demo';
  const plainApiKey = 'hf_live_demo1234567890abcdef12345678';
  const keyHash = crypto.createHash('sha256').update(plainApiKey).digest('hex');
  const keyPrefix = 'hf_live_demo1234';

  await withTransaction(async (client) => {
    // 1. Demo organization
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
       RETURNING id;`,
      ['Acme Demo Org', orgSlug]
    );
    const orgId = orgRes.rows[0]!.id;

    // 2. Demo API key
    await client.query(
      `INSERT INTO api_keys (organization_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key_hash) DO NOTHING;`,
      [orgId, keyHash, keyPrefix, 'Acme Demo Admin Key']
    );

    // 3. Demo Endpoint
    const endpointUrl = 'https://webhook.site/hookforge-demo-endpoint';
    const endpointRes = await client.query<{ id: string }>(
      `SELECT id FROM endpoints WHERE organization_id = $1 AND url = $2 LIMIT 1;`,
      [orgId, endpointUrl]
    );

    let endpointId: string;
    if (endpointRes.rows.length === 0) {
      const insRes = await client.query<{ id: string }>(
        `INSERT INTO endpoints (organization_id, url, description, secret, status, rate_limit_per_minute)
         VALUES ($1, $2, $3, $4, 'active', 600)
         RETURNING id;`,
        [orgId, endpointUrl, 'Demo primary webhook target endpoint', 'whsec_demo_secret_key_1234567890abcdef']
      );
      endpointId = insRes.rows[0]!.id;
    } else {
      endpointId = endpointRes.rows[0]!.id;
    }

    // 4. Demo Event Subscription
    await client.query(
      `INSERT INTO event_subscriptions (organization_id, endpoint_id, event_type, filter_rules)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint_id, event_type) DO UPDATE SET filter_rules = EXCLUDED.filter_rules;`,
      [orgId, endpointId, 'payment.completed', JSON.stringify({ min_amount: 10 })]
    );

    // 5. Demo Circuit Breaker (1:1 with endpoint)
    await client.query(
      `INSERT INTO endpoint_circuit_breakers (endpoint_id, organization_id, state, failure_count, success_count)
       VALUES ($1, $2, 'closed', 0, 0)
       ON CONFLICT (endpoint_id) DO NOTHING;`,
      [endpointId, orgId]
    );

    console.log('\n======================================================');
    console.log('HOOKFORGE DEMO SEED DATA CREATED:');
    console.log(`Organization: Acme Demo Org (${orgId})`);
    console.log(`Demo API Key: ${plainApiKey}`);
    console.log(`Key Prefix:   ${keyPrefix}`);
    console.log(`Endpoint URL: ${endpointUrl} (${endpointId})`);
    console.log('======================================================\n');
  });

  logger.info('Database seeder finished successfully');
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('src/database/seed.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('dist/database/seed.js');

if (isDirectRun) {
  runSeed()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Database seed failed');
      await pool.end();
      process.exit(1);
    });
}
