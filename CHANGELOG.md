# Contract changelog

## 2026-09-23 (v1.1.0)

Perubahan ini **kompatibel** menurut `docs/compatibility.md` (menambah endpoint
dan menambah response field opsional). Alasan: kontrak 1.0.0 sudah mewajibkan
OAuth untuk seluruh operasi protected, tetapi dua capability yang sudah
dideklarasikan pada scope table belum punya operasi di kontrak. Step 11 P4
membutuhkan keduanya untuk empat negative test lintas boundary.

### Added (compatible)

- `POST /pickups` (`createPickup`) dengan scope `orders:fulfil` — operasi khusus
  staff untuk menugaskan driver pada order. Menambah endpoint tidak merusak
  client lama.
- `POST /pickups/{pickupId}/collect` (`collectPickup`) dengan scope
  `pickups:write` — operasi khusus driver untuk menandai penjemputan sudah
  diambil. Ownership check berjalan sebelum mutasi.
- Parameter `PickupId` (`^pku_[A-Za-z0-9]+$`).
- Schema `CreatePickupRequest` (`orderId`, `driverId`, `scheduledAt`).
- Response field opsional `outletId` pada schema `Order` (menambah response
  field bersifat compatible; client lama mengabaikan field yang tidak dikenal).
- Header `WWW-Authenticate` pada response `403 Forbidden`.

### Clarified

- `components.responses.NotFound` kini menyatakan secara eksplisit bahwa objek
  yang tidak ada dan objek yang tidak dapat diakses caller menghasilkan response
  yang identik, termasuk body Problem Details.
- `components.responses.Unauthorized` menjelaskan bahwa claims tidak dipercaya
  sebelum signature, issuer, audience, dan expiry diverifikasi.

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
