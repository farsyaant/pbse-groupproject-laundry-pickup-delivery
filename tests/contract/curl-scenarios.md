# Contract Testing Curl Scenarios

This document contains runnable `curl` commands for all 4 contract testing scenarios for Role B (Integration Owner - Faris).

## Base Configuration
- **Prism Mock Server URL:** `http://127.0.0.1:4010`
- **Default Resource Endpoint:** `/orders`

---

## Scenario 1: GET Collection
**Objective:** Fetch resource collection and verify HTTP 200 & valid JSON collection response.

```bash
curl -i -X GET "http://127.0.0.1:4010/orders" \
  -H "Authorization: Bearer mock_token" \
  -H "Accept: application/json"
```

---

## Scenario 2: GET with Query Filter
**Objective:** Request collection filtered by query parameter (`status=completed`).

```bash
curl -i -X GET "http://127.0.0.1:4010/orders?status=completed" \
  -H "Authorization: Bearer mock_token" \
  -H "Accept: application/json"
```

---

## Scenario 3: POST Unsafe Request WITH Idempotency-Key
**Objective:** Submit resource creation request with required `Idempotency-Key` header. Expect HTTP 201 Created.

```bash
curl -i -X POST "http://127.0.0.1:4010/orders" \
  -H "Authorization: Bearer mock_token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Idempotency-Key: 123e4567-e89b-12d3-a456-426614174000" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
```

---

## Scenario 4: POST Unsafe Request WITHOUT Idempotency-Key
**Objective:** Submit resource creation request missing `Idempotency-Key` header. Expect HTTP 400 Bad Request (or 422/409) with RFC 9457 `application/problem+json` format.

```bash
curl -i -X POST "http://127.0.0.1:4010/orders" \
  -H "Authorization: Bearer mock_token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, application/problem+json" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
```
