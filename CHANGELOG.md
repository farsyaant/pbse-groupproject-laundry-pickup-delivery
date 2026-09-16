# Contract changelog

## 2026-09-15 (v1.0.0 - Breaking Change)

- Updated contract version to `1.0.0` to reflect mandatory OAuth 2.0 / OIDC security requirements for P4.
- Defined `components.securitySchemes.oauth2` supporting `authorizationCode` (Authorization Code + PKCE) and `clientCredentials` flows.
- Established scope vocabulary: `orders:read`, `orders:write`, `pickups:read`, `orders:fulfil`, and `pickups:write`.
- Applied operation-level security requirements to all protected endpoints (`/orders`, `/orders/{orderId}`, `/orders/{orderId}/cancellation`, `/pickups`).
- Added public `/health` monitoring endpoint with `security: []`.
- Standardized `401 Unauthorized` with `WWW-Authenticate` response header, `403 Forbidden` for missing scopes, and `404 Not Found` covering both non-existent and not-owned resources (preventing resource existence probing).

## 2026-09-10 (v0.2.1)

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
