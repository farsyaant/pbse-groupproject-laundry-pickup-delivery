# P3 Integration Test Report — Role B (Faris: Integration Owner)

**Project:** Laundry Pickup & Delivery API  
**Date:** 2026-09-09  
**Tester:** Faris (Integration Owner)  
**Tested Commit:** `b1b8ec3` (Merge pull request #8 from farsyaant/service-owner)  

---

## 1. Executive Summary

This document serves as the formal P3 Integration Test Report confirming that the live Express.js service (`service/`) and Prism mock server match the contract defined in `openapi.yaml`.

- **CI Status:** Workflow `.github/workflows/ci.yml` updated with environment variables (`PORT`, `DATABASE_FILE`, `NODE_ENV`).
- **Prism Mock Contract Test:** 20/20 PASS (0 FAIL).
- **Live Service Contract Test:** 22/22 PASS (0 FAIL).
- **Contract Mismatches:** **No mismatch found.**

---

## 2. Test Execution Details & Environment

### Environment Specs
- **Node.js:** v22.15.1
- **Prism Version:** `@stoplight/prism-cli` v5.14.0 (Mock Port: 4010)
- **Live Service:** Express.js + SQLite (Port: 8080)
- **Test Runner:** `tests/contract/test-contract.js` (Native Node.js `fetch`)

---

## 3. Results Matrix: Prism Mock vs Live Service

| Scenario | Target Prism (`:4010`) | Target Live Service (`:8080/v1`) | Result |
|---|---|---|---|
| **1. GET Collection** (`/orders`) | Status 200 OK | Status 200 OK (`application/json`) | **PASS** |
| **2. GET Filter** (`?status=pending_pickup`) | Status 200 OK | Status 200 OK (Filtered output) | **PASS** |
| **3. POST Unsafe with Key** | Status 201 Created | Status 201 Created + Header `Location` | **PASS** |
| **4. GET Single Order** (`/orders/{id}`) | Status 200 OK | Status 200 OK (Matches ID) | **PASS** |
| **5. Idempotent Retry (Same Key + Body)** | Status 201 Created | Status 201 Created (Same Entity ID) | **PASS** |
| **6. Idempotency Conflict (Same Key + Diff Body)** | Skipped (Static Mock) | Status 409 Conflict | **PASS** |
| **7. POST Unsafe WITHOUT Key** | Status 422 Unprocessable | Status 400 Bad Request + RFC 9457 | **PASS** |
| **8. GET Malformed ID** | Status 400 Bad Request | Status 400 Bad Request | **PASS** |
| **9. GET Non-existent ID** | Status 404 Not Found | Status 404 Not Found | **PASS** |

---

## 4. Detailed Test Logs

### 4.1 Prism Mock Execution Log (`http://127.0.0.1:4010`)
```text
Starting Contract Tests against Target: http://127.0.0.1:4010
Target Type: Prism Mock

[TEST SCENARIO] Skenario 1: GET Collection -> Status 200 (PASS)
[TEST SCENARIO] Skenario 2: GET with Filter -> Status 200 (PASS)
[TEST SCENARIO] Skenario 3: POST unsafe WITH Idempotency-Key -> Status 201 (PASS)
[TEST SCENARIO] Skenario 4: GET Single Order -> Status 200 (PASS)
[TEST SCENARIO] Skenario 5: Idempotent Retry -> Status 201 (PASS)
[TEST SCENARIO] Skenario 6: Idempotency Conflict -> Skipped (Static Mock)
[TEST SCENARIO] Skenario 7: POST unsafe WITHOUT Idempotency-Key -> Status 422 + RFC 9457 Problem Details (PASS)
[TEST SCENARIO] Skenario 8: Negative Tests -> 400 & 404 (PASS)

TEST SUMMARY: 20 Passed, 0 Failed. Result: SUCCESS
```

### 4.2 Live Service Execution Log (`http://127.0.0.1:8080/v1`)
```text
Starting Contract Tests against Target: http://127.0.0.1:8080/v1
Target Type: Live Service

[TEST SCENARIO] Skenario 1: GET Collection -> Status 200 (PASS)
[TEST SCENARIO] Skenario 2: GET with Filter -> Status 200 (PASS)
[TEST SCENARIO] Skenario 3: POST unsafe WITH Idempotency-Key -> Status 201 + Location Header '/v1/orders/ord_MTTVELKPAFE77D' (PASS)
[TEST SCENARIO] Skenario 4: GET Single Order -> Status 200 (PASS)
[TEST SCENARIO] Skenario 5: Idempotent Retry (Same Body) -> Status 201 (PASS)
[TEST SCENARIO] Skenario 6: Idempotency Conflict (Diff Body) -> Status 409 Conflict (PASS)
[TEST SCENARIO] Skenario 7: POST unsafe WITHOUT Idempotency-Key -> Status 400 + RFC 9457 Problem Details (type/title/status/detail/instance) (PASS)
[TEST SCENARIO] Skenario 8: Negative Tests -> Status 400 (Malformed) & Status 404 (Not Found) (PASS)

TEST SUMMARY: 22 Passed, 0 Failed. Result: SUCCESS
```

---

## 5. Contract Mismatch Analysis

**No mismatch found.**

- Payload fields match canonical camelCase specification (`customerId`, `serviceType`, `weightKg`, `pickupAddress`).
- RFC 9457 Problem Details error body provides required 5 members: `type`, `title`, `status`, `detail`, `instance`.

---

## 6. Handoff Note for Tori (Role C — Client Owner)

> **Handoff to Tori:**
> 
> Integration testing for P3 is complete. Both Prism Mock (`http://127.0.0.1:4010`) and Live Service (`http://127.0.0.1:8080/v1`) pass 100% of contract test scenarios.
> 
> You may proceed with the **Client Review** (`docs/p3-client-review.md`).
> Key endpoints ready for client validation:
> 1. `GET /v1/orders` & `GET /v1/orders/{orderId}`
> 2. `POST /v1/orders` (Check 201 + `Location` header)
> 3. `POST /v1/orders` without `Idempotency-Key` (Check RFC 9457 problem+json response)
> 4. `POST /v1/orders/{orderId}/cancellation`
