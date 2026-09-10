# P3 Integration Test Report — Role B (Faris: Integration Owner)

**Project:** Laundry Pickup & Delivery API  
**Date:** 2026-09-09  
**Tester:** Faris (Integration Owner)  
**Tested Commit:** `350dbd2` (service); workflow snapshot `cadf56a`

---

## 1. Executive Summary

This report records the P3 integration evidence for the Prism mock and live Express.js service against `openapi.yaml`.

- **Curl test date:** 2026-09-09 (UTC).
- **Prism contract test:** 28 passed, 0 failed.
- **Live service contract test:** 33 passed, 0 failed locally.
- **Curl scenarios:** PASS for both targets.
- **OpenAPI lint:** Valid, with 4 existing warnings and no errors.
- **Contract mismatch:** No mismatch found. Public deployment re-test passed after manual redeploy.

---

## 2. Test Execution Details & Environment

### Environment Specs
- **Node.js:** v22.15.1
- **Prism Version:** `@stoplight/prism-cli` (Mock Port: 4010)
- **Live Service:** Express.js + SQLite (Port 8080, base path `/v1`)
- **Test Runner:** `tests/contract/test-contract.js` (Native Node.js `fetch`)
- **Curl runner:** Native Git Bash for Windows using `tests/contract/curl-scenarios.sh`.

## 3. Results Matrix: Prism Mock vs Live Service

| Scenario | Target Prism (`:4010`) | Target Live Service (`:8080/v1`) | Result |
|---|---|---|---|
| GET collection and filter | 200 | 200 | **PASS** |
| POST with Idempotency-Key | 201 | 201 + `Location` | **PASS** |
| POST without Idempotency-Key | 422 + problem details | 400 + problem details | **PASS** |
| GET single, malformed, and unknown IDs | 200, 400, 404 | 200, 400, 404 | **PASS** |
| Idempotent retry, same key/body | Same entity | Same entity | **PASS** |
| Idempotency conflict, different body | Static mock skipped | 409 | **PASS** |
| Pagination (`limit=1`) | 200, max 1 item | 200, max 1 item | **PASS** |
| Empty collection (`status=completed`) | Static example returned | 200, `[]` | **PASS** |
| Invalid and domain-invalid body | 422 + problem details | 400 / 422 + problem details | **PASS** |

## 4. Curl Scenario Evidence

Raw output is stored in [Prism curl evidence](p3-curl-evidence-prism.txt) and [live service curl evidence](p3-curl-evidence-service.txt).

- **Prism:** GET collection 200; GET filter 200; POST with key 201; POST without key 422 with `application/problem+json`.
- **Live service:** GET collection 200; GET filter 200; POST with key 201 and `Location`; POST without key 400 with `application/problem+json`.
- Only `BASE_URL` and the live endpoint prefix variables differed between targets.

## 5. Coverage Against PDF Requirements

| Requirement | Coverage |
|---|---|
| GET single order 200 | Covered |
| GET malformed ID 400 | Covered |
| GET unknown ID 404 | Covered |
| GET collection filter | Covered |
| GET collection pagination | Covered by `limit=1` |
| GET empty collection | Covered; live service asserts `[]` |
| POST success 201 | Covered |
| POST `Location` header | Covered for live service |
| POST missing key 400 | Covered for live service |
| POST invalid body 400 | Covered; Prism returns contract-valid 422 |
| Domain-invalid body 422 | Covered with invalid `customerId` |
| Idempotent same key/body | Covered; same entity ID asserted |
| Idempotent same key/different body 409 | Covered for live service |
| Problem Details fields | Covered: `type`, `title`, `status`, `detail`, `instance` |
| Invalid field extension | Covered locally: `invalidFields` |

## 6. Contract Mismatch Analysis

**No mismatch found at the contract level.**

- Payload fields match canonical camelCase specification (`customerId`, `serviceType`, `weightKg`, `pickupAddress`).
- RFC 9457 Problem Details error body provides the required `type`, `title`, `status`, `detail`, and `instance` members.
- Prism is a static mock: it returns the documented example for filtered and empty queries and cannot execute the live idempotency conflict behavior. These limitations are recorded rather than treated as service failures.
- Missing idempotency key returns 422 from Prism and 400 from the service; both statuses are represented in the OpenAPI contract.

## 7. CI and Handoff

- **GitHub Actions:** [Contract Test CI](https://github.com/farsyaant/pbse-groupproject-laundry-pickup-delivery/actions)
- **OpenAPI lint:** Valid with 4 warnings; no lint errors.

**Handoff to Tori:**

Integration test selesai.

Bukti:
- Contract test mock: PASS
- Contract test service: PASS, 33 assertions
- Curl scenarios mock: PASS
- Curl scenarios service: PASS
- CI: workflow tersedia; public deployment contract test PASS
- OpenAPI lint: PASS (warnings only)
- Mismatch: No mismatch found

Tori dapat mulai client review.
