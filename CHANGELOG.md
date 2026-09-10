# Contract changelog

## 2026-09-10

- Added `invalidFields` Problem Details extension for request validation errors.

## 2026-09-08

- Finalized Session 3 contract behavior for unauthenticated local implementation.
- Added `Location` header to `POST /orders` response `201`.
- Added malformed identifier response `400` to `GET /orders/{orderId}`.
- Enforced UUID v4 format for `Idempotency-Key`.
- Added identifier patterns to resource schemas.

## 2026-09-02

- Finalized resource modeling for orders, pickups, and cancellations.
- Documented rejected UI/process candidates in `docs/resource-modeling.md`.
- Added collection pagination parameters and completed order status enums.
- Expanded Idempotency-Key and RFC 9457 conflict behavior in the OpenAPI contract.
