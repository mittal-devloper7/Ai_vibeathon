-- =====================================================================
-- HookForge Initial Schema: 10 MVP Tables
-- =====================================================================

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. API Keys
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    key_prefix VARCHAR(16) NOT NULL,
    name VARCHAR(100) NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;

-- 3. Endpoints (Webhook Destinations)
CREATE TABLE IF NOT EXISTS endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    description TEXT,
    secret VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'failing')),
    rate_limit_per_minute INT NOT NULL DEFAULT 600 CHECK (rate_limit_per_minute > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_endpoints_id_org UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_endpoints_org ON endpoints(organization_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_status ON endpoints(status);

-- 4. Event Subscriptions
CREATE TABLE IF NOT EXISTS event_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    endpoint_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    filter_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_subscriptions_endpoint_org FOREIGN KEY (endpoint_id, organization_id)
        REFERENCES endpoints(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT uq_subscriptions_endpoint_event UNIQUE (endpoint_id, event_type)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_event ON event_subscriptions(organization_id, event_type);

-- 5. Webhook Events (Ingested events)
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(255) NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_org_idempotency 
    ON webhook_events(organization_id, idempotency_key) 
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_org_created 
    ON webhook_events(organization_id, created_at DESC);

-- 6. Deliveries (Per-endpoint delivery tasks)
CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    webhook_event_id UUID NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
    endpoint_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'delivered', 'failed', 'exhausted')),
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INT NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    next_retry_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_deliveries_endpoint_org FOREIGN KEY (endpoint_id, organization_id)
        REFERENCES endpoints(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deliveries_org_created ON deliveries(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint_status ON deliveries(endpoint_id, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_retry ON deliveries(next_retry_at) 
    WHERE status IN ('pending', 'failed') AND next_retry_at IS NOT NULL;

-- 7. Delivery Attempts (Historical HTTP attempt records)
CREATE TABLE IF NOT EXISTS delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL CHECK (attempt_number > 0),
    status_code INT NULL,
    response_headers JSONB NULL,
    response_body TEXT NULL,
    error_message TEXT NULL,
    duration_ms INT NULL CHECK (duration_ms >= 0),
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_delivery_attempts_delivery_attempt UNIQUE (delivery_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_delivery ON delivery_attempts(delivery_id);

-- 8. Outbox Events (Transactional Outbox Pattern)
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_name VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
    published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON outbox_events(created_at) 
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_events_org ON outbox_events(organization_id);

-- 9. Endpoint Circuit Breakers
CREATE TABLE IF NOT EXISTS endpoint_circuit_breakers (
    endpoint_id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    state VARCHAR(50) NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
    failure_count INT NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    success_count INT NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    last_failure_at TIMESTAMPTZ NULL,
    next_attempt_after TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_circuit_breakers_endpoint_org FOREIGN KEY (endpoint_id, organization_id)
        REFERENCES endpoints(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_circuit_breakers_org ON endpoint_circuit_breakers(organization_id);

-- 10. Dead Letter Entries
CREATE TABLE IF NOT EXISTS dead_letter_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    endpoint_id UUID NOT NULL,
    webhook_event_id UUID NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    payload JSONB NOT NULL,
    last_status_code INT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_dead_letter_endpoint_org FOREIGN KEY (endpoint_id, organization_id)
        REFERENCES endpoints(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dead_letter_org ON dead_letter_entries(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letter_endpoint ON dead_letter_entries(endpoint_id);
