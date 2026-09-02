#!/usr/bin/env bash
# ==============================================================================
# Contract Test Suite - Terminal Curl Scenarios
# Role B: Faris (Integration Owner)
#
# Target Mock Server: Prism running on http://127.0.0.1:4010
# Prerequisite: pnpm dlx @stoplight/prism-cli mock openapi.yaml -p 4010
# ==============================================================================

BASE_URL="${BASE_URL:-http://127.0.0.1:4010}"
ENDPOINT_COLLECTION="${ENDPOINT_COLLECTION:-/v1/orders}"
ENDPOINT_CREATE="${ENDPOINT_CREATE:-/v1/orders}"

echo "======================================================================"
echo " Contract Test Curl Scenarios against ${BASE_URL}"
echo "======================================================================"
echo ""

# ------------------------------------------------------------------------------
# Scenario 1: GET Collection (e.g. GET /v1/orders)
# Expect: HTTP 200 OK & valid JSON array/collection response
# ------------------------------------------------------------------------------
echo "[Scenario 1] GET Collection: ${BASE_URL}${ENDPOINT_COLLECTION}"
curl -i -X GET "${BASE_URL}${ENDPOINT_COLLECTION}" \
  -H "Accept: application/json"
echo -e "\n\n----------------------------------------------------------------------\n"

# ------------------------------------------------------------------------------
# Scenario 2: GET with Filter (e.g. GET /v1/orders?status=completed)
# Expect: HTTP 200 OK & filtered output
# ------------------------------------------------------------------------------
echo "[Scenario 2] GET with Filter: ${BASE_URL}${ENDPOINT_COLLECTION}?status=completed"
curl -i -X GET "${BASE_URL}${ENDPOINT_COLLECTION}?status=completed" \
  -H "Accept: application/json"
echo -e "\n\n----------------------------------------------------------------------\n"

# ------------------------------------------------------------------------------
# Scenario 3: POST Unsafe with Idempotency-Key
# Expect: HTTP 201 Created or 200 OK
# ------------------------------------------------------------------------------
IDEMPOTENCY_KEY=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "123e4567-e89b-12d3-a456-426614174000")

echo "[Scenario 3] POST Unsafe WITH Idempotency-Key (${IDEMPOTENCY_KEY})"
curl -i -X POST "${BASE_URL}${ENDPOINT_CREATE}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
  -d '{
    "customer_id": "cust_12345",
    "service_type": "wash_fold",
    "weight_kg": 5.5,
    "pickup_address": "Jl. Merdeka No. 10, Jakarta"
  }'
echo -e "\n\n----------------------------------------------------------------------\n"

# ------------------------------------------------------------------------------
# Scenario 4: POST Unsafe WITHOUT Idempotency-Key
# Expect: Rejection (HTTP 400, 409, or 422) with RFC 9457 application/problem+json format
# ------------------------------------------------------------------------------
echo "[Scenario 4] POST Unsafe WITHOUT Idempotency-Key (Expect Rejection)"
curl -i -X POST "${BASE_URL}${ENDPOINT_CREATE}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, application/problem+json" \
  -d '{
    "customer_id": "cust_12345",
    "service_type": "wash_fold",
    "weight_kg": 5.5,
    "pickup_address": "Jl. Merdeka No. 10, Jakarta"
  }'
echo -e "\n"
