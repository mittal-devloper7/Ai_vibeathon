-- =====================================================================
-- HookForge Migration 002: Phase 2 Core Backend Adjustments
-- =====================================================================

-- 1. Organizations: status for tenant lifecycle
ALTER TABLE organizations 
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));

-- 2. API Keys: scoped permissions
ALTER TABLE api_keys 
    ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{"*"}';

-- 3. Endpoints: name, signing_key_id, and delivery retry policy
ALTER TABLE endpoints 
    ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT 'Default Endpoint';

ALTER TABLE endpoints 
    ADD COLUMN IF NOT EXISTS signing_key_id VARCHAR(64) NOT NULL DEFAULT 'key_default';

ALTER TABLE endpoints 
    ADD COLUMN IF NOT EXISTS policy JSONB NOT NULL DEFAULT '{"max_attempts": 5, "attempt_timeout_ms": 10000, "max_in_flight": 10}'::jsonb;

-- 4. Webhook Events: payload SHA-256 for canonical idempotency comparison
ALTER TABLE webhook_events 
    ADD COLUMN IF NOT EXISTS payload_sha256 VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_sha256 
    ON webhook_events(organization_id, payload_sha256);

-- 5. Deliveries: replay number tracking and last error
ALTER TABLE deliveries 
    ADD COLUMN IF NOT EXISTS replay_number INT NOT NULL DEFAULT 0;

ALTER TABLE deliveries 
    ADD COLUMN IF NOT EXISTS last_error TEXT NULL;

-- 6. Outbox Events: deduplication key and delivery association
ALTER TABLE outbox_events 
    ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255) NULL;

ALTER TABLE outbox_events 
    ADD COLUMN IF NOT EXISTS delivery_id UUID NULL REFERENCES deliveries(id) ON DELETE CASCADE;

ALTER TABLE outbox_events 
    ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_events_org_dedupe 
    ON outbox_events(organization_id, dedupe_key) 
    WHERE dedupe_key IS NOT NULL;
