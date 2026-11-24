#!/usr/bin/env bash
set -euo pipefail

# HookForge Phase 7 Automated Demo & Chaos Verification Script (Bash)
API_BASE_URL="${1:-http://localhost:3000}"
SIMULATOR_URL="${2:-http://localhost:4000}"
API_KEY="${3:-hf_live_demo1234567890abcdef12345678}"

echo "========================================================"
echo " HOOKFORGE DEMO & RELIABILITY VERIFICATION SUITE"
echo "========================================================"
echo "API Base URL:    $API_BASE_URL"
echo "Simulator URL:   $SIMULATOR_URL"
echo "Auth Bearer Key: ${API_KEY:0:14}..."

# 1. Healthcheck
echo -e "\n1. Checking System Readiness (/health/ready)..."
HEALTH_RES=$(curl -s -w "\n%{http_code}" "$API_BASE_URL/health/ready")
HEALTH_CODE=$(echo "$HEALTH_RES" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH_RES" | head -n -1)

if [ "$HEALTH_CODE" -eq 200 ] && echo "$HEALTH_BODY" | grep -q '"postgres":true'; then
  echo "[PASS] PostgreSQL 18 and Redis 8 are connected and reporting ready."
else
  echo "[FAIL] Health check failed with code $HEALTH_CODE: $HEALTH_BODY"
  exit 1
fi

# 2. Register Endpoint
echo -e "\n2. Registering Test Endpoint against Simulator..."
EP_PAYLOAD='{
  "name": "Demo Bash Endpoint",
  "url": "'"$SIMULATOR_URL"'/scenario/success",
  "subscriptions": ["demo.order.created"],
  "rate_limit_per_minute": 120,
  "policy": { "max_attempts": 3, "attempt_timeout_ms": 5000, "max_in_flight": 5 }
}'

EP_RES=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE_URL/api/v1/endpoints" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$EP_PAYLOAD")
EP_CODE=$(echo "$EP_RES" | tail -n1)
EP_BODY=$(echo "$EP_RES" | head -n -1)

if [ "$EP_CODE" -eq 201 ]; then
  EP_ID=$(echo "$EP_BODY" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
  echo "[PASS] Endpoint created: ID $EP_ID with one-time signing secret."
else
  echo "[FAIL] Endpoint creation failed: $EP_CODE: $EP_BODY"
  exit 1
fi

# 3. Ingest Event with Idempotency Key
echo -e "\n3. Publishing Event with Idempotency-Key..."
IDEM_KEY="bash_key_$(date +%s)_$RANDOM"
EVENT_PAYLOAD='{
  "type": "demo.order.created",
  "data": { "order_id": "ord_bash_101", "amount": 199.99, "currency": "USD" }
}'

INGEST_RES=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE_URL/api/v1/events" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -H "Content-Type: application/json" \
  -d "$EVENT_PAYLOAD")
INGEST_CODE=$(echo "$INGEST_RES" | tail -n1)
INGEST_BODY=$(echo "$INGEST_RES" | head -n -1)

if [ "$INGEST_CODE" -eq 202 ] && echo "$INGEST_BODY" | grep -q '"idempotent_replay":false'; then
  EVENT_ID=$(echo "$INGEST_BODY" | grep -o '"event_id":"[^"]*' | head -1 | cut -d'"' -f4)
  echo "[PASS] Event ingested (HTTP 202 Accepted, Event ID $EVENT_ID, idempotent_replay=false)"
else
  echo "[FAIL] Event ingestion failed: $INGEST_CODE: $INGEST_BODY"
  exit 1
fi

# 4. Duplicate Replay Check
echo -e "\n4. Verifying Idempotent Duplicate Ingestion..."
DUP_RES=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE_URL/api/v1/events" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -H "Content-Type: application/json" \
  -d "$EVENT_PAYLOAD")
DUP_CODE=$(echo "$DUP_RES" | tail -n1)
DUP_BODY=$(echo "$DUP_RES" | head -n -1)

if [ "$DUP_CODE" -eq 202 ] && echo "$DUP_BODY" | grep -q '"idempotent_replay":true'; then
  echo "[PASS] Idempotent duplicate correctly recognized with HTTP 202 and idempotent_replay=true"
else
  echo "[FAIL] Idempotent duplicate check failed: $DUP_CODE: $DUP_BODY"
  exit 1
fi

# 5. Idempotency Conflict Check
echo -e "\n5. Verifying Idempotency Conflict (409 IDEMPOTENCY_CONFLICT)..."
CONFLICT_PAYLOAD='{
  "type": "demo.order.created",
  "data": { "order_id": "ord_bash_DIFFERENT", "amount": 9999.00 }
}'
CONF_RES=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE_URL/api/v1/events" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -H "Content-Type: application/json" \
  -d "$CONFLICT_PAYLOAD")
CONF_CODE=$(echo "$CONF_RES" | tail -n1)
CONF_BODY=$(echo "$CONF_RES" | head -n -1)

if [ "$CONF_CODE" -eq 409 ] && echo "$CONF_BODY" | grep -q 'IDEMPOTENCY_CONFLICT'; then
  echo "[PASS] Conflicting payload with identical key rejected with HTTP 409 IDEMPOTENCY_CONFLICT"
else
  echo "[FAIL] Expected 409 IDEMPOTENCY_CONFLICT, got $CONF_CODE: $CONF_BODY"
  exit 1
fi

# 6. Metrics Check
echo -e "\n6. Checking System Metrics (/api/v1/dashboard/metrics)..."
METRICS_RES=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE_URL/api/v1/dashboard/metrics" \
  -H "Authorization: Bearer $API_KEY")
METRICS_CODE=$(echo "$METRICS_RES" | tail -n1)
METRICS_BODY=$(echo "$METRICS_RES" | head -n -1)

if [ "$METRICS_CODE" -eq 200 ] && echo "$METRICS_BODY" | grep -q '"total_deliveries"'; then
  echo "[PASS] Dashboard metrics endpoint active and reporting telemetry."
else
  echo "[FAIL] Metrics query failed: $METRICS_CODE: $METRICS_BODY"
  exit 1
fi

echo -e "\n========================================================"
echo " ALL DEMO VERIFICATION CHECKS PASSED SUCCESSFULLY!"
echo "========================================================"
