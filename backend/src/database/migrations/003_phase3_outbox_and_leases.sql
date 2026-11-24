-- =====================================================================
-- HookForge Migration 003: Phase 3 Outbox Leases, Delivery Attempts & Fencing
-- =====================================================================

-- 1. Outbox Events: lease token, lease owner, expiration, and retry schedule
ALTER TABLE outbox_events 
    ADD COLUMN IF NOT EXISTS lease_owner VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS lease_token UUID NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL;

ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS outbox_events_status_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_status_check 
    CHECK (status IN ('pending', 'processing', 'published', 'failed'));

CREATE INDEX IF NOT EXISTS idx_outbox_due 
    ON outbox_events(created_at) 
    WHERE published_at IS NULL;

-- 2. Deliveries: lease fencing, execution tracking, and status expansion
ALTER TABLE deliveries 
    ADD COLUMN IF NOT EXISTS lease_owner VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS lease_token UUID NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_http_status INT NULL,
    ADD COLUMN IF NOT EXISTS last_failure_class VARCHAR(100) NULL;

-- Update deliveries status check to include Phase 3 processing and completion states
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check 
    CHECK (status IN ('pending', 'in_progress', 'processing', 'delivered', 'succeeded', 'failed', 'retry_scheduled', 'exhausted', 'dead_lettered'));

CREATE INDEX IF NOT EXISTS idx_deliveries_due 
    ON deliveries(status, next_attempt_at) 
    WHERE status IN ('pending', 'retry_scheduled');

-- 3. Delivery Attempts: diagnostic telemetry columns
ALTER TABLE delivery_attempts 
    ADD COLUMN IF NOT EXISTS attempt_no INT NULL,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS outcome VARCHAR(50) NULL,
    ADD COLUMN IF NOT EXISTS failure_class VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS http_status INT NULL,
    ADD COLUMN IF NOT EXISTS latency_ms INT NULL,
    ADD COLUMN IF NOT EXISTS remote_ip VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS request_bytes INT NULL,
    ADD COLUMN IF NOT EXISTS response_bytes INT NULL,
    ADD COLUMN IF NOT EXISTS response_excerpt TEXT NULL,
    ADD COLUMN IF NOT EXISTS key_id VARCHAR(64) NULL;
