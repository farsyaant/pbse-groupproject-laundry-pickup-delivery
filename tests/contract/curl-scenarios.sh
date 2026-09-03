#!/usr/bin/env bash
# Contract test scenarios for the Prism mock server.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4010}"
ENDPOINT_COLLECTION="${ENDPOINT_COLLECTION:-/orders}"
ENDPOINT_CREATE="${ENDPOINT_CREATE:-/orders}"

echo "======================================================================"
echo " Contract Test Curl Scenarios against ${BASE_URL}"
echo "======================================================================"

echo "[Scenario 1] GET Collection: ${BASE_URL}${ENDPOINT_COLLECTION}"
curl -i -X GET "${BASE_URL}${ENDPOINT_COLLECTION}" \
  -H "Authorization: Bearer mock_token" \
  -H "Accept: application/json"
echo

echo "[Scenario 2] GET with Filter: ${BASE_URL}${ENDPOINT_COLLECTION}?status=completed"
curl -i -X GET "${BASE_URL}${ENDPOINT_COLLECTION}?status=completed" \
  -H "Authorization: Bearer mock_token" \
  -H "Accept: application/json"
echo

IDEMPOTENCY_KEY="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "123e4567-e89b-12d3-a456-426614174000")"

echo "[Scenario 3] POST Unsafe WITH Idempotency-Key (${IDEMPOTENCY_KEY})"
curl -i -X POST "${BASE_URL}${ENDPOINT_CREATE}" \
  -H "Authorization: Bearer mock_token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
echo

echo "[Scenario 4] POST Unsafe WITHOUT Idempotency-Key"
curl -i -X POST "${BASE_URL}${ENDPOINT_CREATE}" \
  -H "Authorization: Bearer mock_token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, application/problem+json" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
