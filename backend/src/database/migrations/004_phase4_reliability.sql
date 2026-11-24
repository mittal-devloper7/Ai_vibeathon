-- =====================================================================
-- HookForge Migration 004: Phase 4 Reliability Engine
-- =====================================================================

-- 1. Deliveries: Replay lineage and efficient index lookups
ALTER TABLE deliveries
    ADD COLUMN IF NOT EXISTS replay_of_delivery_id UUID NULL REFERENCES deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deliveries_replay_of 
    ON deliveries(replay_of_delivery_id) 
    WHERE replay_of_delivery_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deliveries_retry_scheduled_due 
    ON deliveries(status, next_attempt_at) 
    WHERE status = 'retry_scheduled';

CREATE INDEX IF NOT EXISTS idx_deliveries_processing_stalled 
    ON deliveries(status, lease_expires_at) 
    WHERE status = 'processing';

-- 2. Dead Letter Entries: Replay tracking and resolution metadata
ALTER TABLE dead_letter_entries
    ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS replay_delivery_id UUID NULL REFERENCES deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dead_letter_delivery 
    ON dead_letter_entries(delivery_id);

-- 3. Endpoint Circuit Breakers: Cooldown tracking and state metadata
ALTER TABLE endpoint_circuit_breakers
    ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS open_until TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_state_change_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
