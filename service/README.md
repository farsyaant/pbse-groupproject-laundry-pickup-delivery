# Laundry Pickup & Delivery — Service

Resource server untuk sistem Laundry Pickup & Delivery. Service ini **tidak
menerbitkan token** dan tidak pernah menerima password: seluruh penerbitan token
adalah tugas authorization server (Keycloak lokal, lihat
`docs/p4-authorization-server.md`).

## Prasyarat

- Node.js >= 18
- pnpm (atau npm)
- sqlite3 CLI (untuk seed)

## Instalasi

```bash
cd service
pnpm install
```

## Konfigurasi

Salin `.env.example` ke `.env`:

```bash
cp .env.example .env
```

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `PORT` | Ya | `8080` | Port HTTP |
| `DATABASE_FILE` | Ya | `./db/laundry.sqlite` | Path file SQLite |
| `NODE_ENV` | Tidak | `development` | Environment |
| `OIDC_ISSUER` | Ya | - | Issuer dari discovery document OIDC |
| `OIDC_JWKS_URI` | Ya | - | URL JWKS publik authorization server |
| `OIDC_AUDIENCE` | Ya | - | Audience API yang didaftarkan pada authorization server |

Service gagal start (exit non-zero) jika salah satu variable wajib kosong. Uji:

```bash
OIDC_ISSUER= node src/app.js
# FATAL  Missing required environment variable: OIDC_ISSUER
```

## Database

Schema diterapkan otomatis saat startup, termasuk **migrasi in-place** kolom
`orders.outlet_id` dan tabel `pickups` untuk database P3 yang sudah ada. Data P3
tidak dihapus. Untuk membuat database dari kosong:

```bash
rm -f db/laundry.sqlite
node src/app.js
```

Untuk menerapkan seed:

```bash
sqlite3 db/laundry.sqlite < db/seed.sql
```

## Menjalankan Service

```bash
node src/app.js
```

Port default: **8080**

Health check (public, tanpa token): `http://127.0.0.1:8080/health`

## Tiga Lapisan Pemeriksaan Akses

Ketiga lapisan **terpisah, berurutan, dan tidak digabung** menjadi satu kondisi:

| Layer | File | Pertanyaan | Kegagalan |
|---|---|---|---|
| 1 — Authentication | `src/auth/authenticate.js`, `verify.js`, `principal.js` | Siapa pengirim request? | `401` |
| 2 — Scope | `src/auth/require-scope.js` | Bolehkah token ini melakukan operasi tersebut? | `403` |
| 3 — Object | `src/auth/ownership.js` | Bolehkah caller mengakses objek yang disebut? | `404` |

Urutan eksekusi: `authenticate` → `requireScope` → load objek → ownership check →
mutasi/response. Pemeriksaan scope **selalu** mendahului query database, sehingga
`403` tidak pernah membocorkan keberadaan identifier.

`404` untuk objek yang tidak ada dan objek yang bukan milik caller **identik**
(status, header, dan body Problem Details). Instance path pun disamakan
(`/v1/orders/{orderId}`), karena instance yang berbeda juga bisa dipakai untuk
enumerasi.

## Daftar Endpoint

| Method | Path | Scope Wajib | Status |
|---|---|---|---|
| GET | `/health` | - (public, `security: []`) | Selesai |
| GET | `/v1/orders` | `orders:read` | Selesai |
| GET | `/v1/orders/{orderId}` | `orders:read` | Selesai |
| POST | `/v1/orders` | `orders:write` | Selesai |
| POST | `/v1/orders/{orderId}/cancellation` | `orders:write` | Selesai |
| POST | `/v1/orders/{orderId}/fulfilment` | `orders:fulfil` | Selesai (operasi khusus staff) |
| GET | `/v1/pickups` | `pickups:read` | Selesai |
| POST | `/v1/pickups` | `orders:fulfil` | Selesai (staff menugaskan driver) |
| POST | `/v1/pickups/{pickupId}/collect` | `pickups:write` | Selesai (operasi khusus driver) |

Operasi yang menyebut identifier objek:

- `GET /v1/orders/{orderId}` → objek **order**
- `POST /v1/orders/{orderId}/cancellation` → objek **order** (write)
- `POST /v1/orders/{orderId}/fulfilment` → objek **order** (write)
- `POST /v1/pickups` → objek **order** yang disebut di body (write)
- `POST /v1/pickups/{pickupId}/collect` → objek **pickup** (write)
- `GET /v1/orders`, `GET /v1/pickups` → **collection**, dibatasi di dalam query

> Catatan pemetaan domain: contoh pada materi memakai
> `PATCH /v1/deliveries/{id}/collect`. Domain kelompok ini memakai resource
> **Pickup** (`openapi.yaml`), jadi padanannya adalah
> `POST /v1/pickups/{pickupId}/collect` dengan scope `pickups:write`.

## Scope Vocabulary (P4)

Scope berformat `resource:action`, dirancang dari **capability aktor**, bukan dari
daftar endpoint. String-nya identik di tiga tempat: `openapi.yaml`,
authorization server (`auth/keycloak/prepare.mjs`), dan `requireScope(...)`.

| Scope | Capability | Pemegang | Operation di Kontrak |
|---|---|---|---|
| `orders:read` | Membaca daftar dan detail order dalam kewenangan caller | Customer, Staff, Scheduled Job | `listOrders`, `getOrder` |
| `orders:write` | Membuat order baru dan membatalkan order milik caller | Customer | `createOrder`, `cancelOrder` |
| `pickups:read` | Membaca daftar dan detail penjemputan dalam kewenangan caller | Driver, Staff, Scheduled Job | `listPickups` |
| `orders:fulfil` | Menerima order ke outlet dan menugaskan driver (operasi staff) | Staff | `fulfilOrder`, `createPickup` |
| `pickups:write` | Menandai penjemputan yang ditugaskan sebagai sudah diambil | Driver | `collectPickup` |

`orders:fulfil` **bukan** scope "satu per endpoint": scope ini dipakai oleh dua
operasi yang sama-sama merupakan capability staf (menerima order dan menugaskan
driver). Dengan begitu jumlah scope (5) tetap jauh di bawah jumlah operasi (9).

Aktor yang tidak memakai sebuah capability tidak menerima scope-nya: customer
tidak mendapat `pickups:write`, driver tidak mendapat `orders:fulfil`. Tabel
pemetaan role lengkap ada di `docs/p4-contract-handoff.md`.

## Object Ownership Rules (P4)

| Route | Aturan Kepemilikan Objek | Penolakan Bukan Milik |
|---|---|---|
| `GET /v1/orders` | Customer: `WHERE customer_id = principal.domainId`. Staff: `WHERE outlet_id = principal.outletId`. Dibatasi di query database, bukan filter di JavaScript. | - (difilter di query) |
| `GET /v1/orders/{orderId}` | Order milik customer (`domainId === customer_id`), **atau** staff outlet yang order itu terikat padanya (`outlet_id === principal.outletId`), **atau** driver yang ditugaskan pada pickup order tersebut. | `404` identik |
| `POST /v1/orders` | Customer hanya boleh membuat order untuk identitas domain miliknya (`body.customerId === principal.domainId`). Order baru belum terikat outlet (`outlet_id = NULL`). | `404` identik |
| `POST /v1/orders/{orderId}/cancellation` | Hanya customer pemilik order. Ownership diperiksa **sebelum** status diubah; urutan status bisnis diperiksa setelahnya. | `404` identik |
| `POST /v1/orders/{orderId}/fulfilment` | Staff hanya boleh menerima order yang belum terikat outlet mana pun (`outlet_id IS NULL`), atau order yang sudah terikat pada outletnya sendiri. Order yang terikat outlet lain tidak dapat dijangkau. Mutasi (`outlet_id`, `status`) hanya setelah ownership terbukti. | `404` identik |
| `POST /v1/pickups` | Staff hanya boleh menugaskan driver untuk order yang belum terikat atau terikat outletnya sendiri. Order di-load dan diperiksa sebelum pickup ditulis. | `404` identik |
| `POST /v1/pickups/{pickupId}/collect` | Hanya driver yang tercatat pada `pickup.driver_id`. Ownership diperiksa **sebelum** status/`collected_at` ditulis. | `404` identik |
| `GET /v1/pickups` | Driver: `WHERE driver_id = principal.domainId`. Staff: pickup yang order-nya berada di outletnya. Dibatasi di query database. | - (difilter di query) |

Aturan tambahan:

- `outletId` berasal dari **claim provider**, bukan dari request. Caller tidak
  bisa memilih outlet mana yang ia wakili.
- Identitas domain (`domainId`) berasal dari claim `fixture_domain_id` (atau
  `sub`), bukan dari `customerId` di body/URL.
- Order yang dibuat pada P3 (tanpa outlet) tetap dapat dibaca oleh customer-nya.

## Contoh Request

### GET /health

```bash
curl -i http://127.0.0.1:8080/health
```

### Tanpa token → 401

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/v1/orders
# 401
```

### GET single order (dengan token)

```bash
curl -i http://127.0.0.1:8080/v1/orders/ord_seed001 \
  -H "Authorization: Bearer $TOKEN"
```

### POST order

```bash
curl -i -X POST http://127.0.0.1:8080/v1/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 423e4567-e89b-42d3-a456-426614174000" \
  -d '{"customerId":"cus_01HZX2Y1AB","serviceType":"wash_fold","weightKg":5.5,"pickupAddress":"Jl. Merdeka No. 10, Jakarta"}'
```

### POST fulfilment (staff, `orders:fulfil`)

```bash
curl -i -X POST http://127.0.0.1:8080/v1/orders/ord_seed001/fulfilment \
  -H "Authorization: Bearer $STAFF_TOKEN"
```

### POST pickup dispatch (staff) lalu collect (driver)

```bash
curl -i -X POST http://127.0.0.1:8080/v1/pickups \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 523e4567-e89b-42d3-a456-426614174001" \
  -d '{"orderId":"ord_seed001","driverId":"drv_courierA","scheduledAt":"2026-09-03T09:00:00Z"}'

curl -i -X POST http://127.0.0.1:8080/v1/pickups/pku_XXXX/collect \
  -H "Authorization: Bearer $COURIER_TOKEN"
```

## Failure Mapping

| Kondisi | Status | Problem Type | Catatan / Header |
|---|---|---|---|
| Token hilang, invalid, expired, signature salah, issuer/audience salah | 401 | `unauthorized` | `WWW-Authenticate: Bearer error="invalid_token"` |
| Token valid tapi scope kurang | 403 | `forbidden` | `WWW-Authenticate: Bearer error="insufficient_scope", scope="..."`; dievaluasi sebelum query database |
| Objek tidak ditemukan | 404 | `not-found` | Instance path memakai template kontrak |
| Objek ada tapi bukan milik caller | 404 | `not-found` | Body **identik** dengan kasus tidak ditemukan |
| JSON malformed | 400 | `bad-request` | - |
| Field wajib hilang / tipe salah | 400 | `bad-request` | `invalidFields` |
| Order/Pickup ID malformed | 400 | `bad-request` | - |
| Idempotency-Key hilang atau bukan UUID v4 | 400 | `bad-request` | - |
| Limit di luar range / status filter tidak valid | 400 | `bad-request` | - |
| Idempotency key + body berbeda | 409 | `idempotency-conflict` | - |
| Cancellation pada status yang tidak diizinkan | 409 | `order-not-cancellable` | `currentStatus`, `allowedStatuses` |
| Domain validation gagal | 422 | `validation-failed` | `invalidFields` |
| Unexpected error | 500 | `internal-error` | - |

Semua error memakai `Content-Type: application/problem+json`.

## Redaksi Log (Step 9)

`src/logger.js` meredaksi `Authorization`, `Cookie`, dan `Set-Cookie` pada logging
boundary. Log hanya memuat method, path, status, correlation id, dan alasan
penolakan yang stabil (mis. `ERR_JWT_CLAIM_VALIDATION_FAILED`). Tidak ada request
object lengkap dan tidak ada token yang dicatat.

Verifikasi:

```bash
node tests/authz/test-authz.js   # termasuk pemeriksaan kebocoran token di output service
```

## Menjalankan Test

```bash
# Dari root repository
node tests/authz/test-authz.js                              # 4 negative test + Layer 1
node tests/authz/verify-checks-are-live.js                  # bukti tiap boundary benar-benar diuji
node tests/contract/test-contract.js                        # terhadap Prism mock
node tests/contract/run-against-service.js                   # contract suite vs service terautentikasi
node tests/contract/check-legacy-migration.js                # migrasi database P3 in-place
node tests/contract/test-persistence-restart.js              # persistensi lintas restart
node tests/contract/test-idempotency-concurrency.js          # idempotency di bawah concurrency
npx @redocly/cli lint openapi.yaml
```

Atau dari `service/`:

```bash
pnpm run test          # migration + authz + contract + persistence + concurrency
pnpm run test:authz
pnpm run test:authz-live
```

Semua test auth memakai **signing key khusus test** (`tests/helpers/harness.js`)
dan menjalankan service terhadap JWKS lokal, sehingga CI tidak bergantung pada
network atau authorization server live. Verifier tetap menjalankan seluruh
pemeriksaan (signature, algoritma, issuer, audience, expiry) — tidak ada jalur
bypass autentikasi untuk test.

## Known Issues / Batasan

- Relasi staf-ke-outlet berasal dari claim provider (`outlet_id` atau
  `fixture_domain_id` saat role `staff`). Model multi-outlet per pengguna belum
  didukung.
- Order P3 yang sudah ada tidak memiliki outlet, sehingga hanya customer
  pemiliknya yang dapat membacanya sampai sebuah outlet menerimanya.
- `GET /v1/pickups` memakai cursor pagination yang sama dengan `GET /v1/orders`.
- Bukti refresh-token rotation berada di `docs/decisions/0003-autentikasi.md`
  dan dijalankan manual terhadap Keycloak lokal (bukan bagian dari test CI).

## P3 Verification Commands

Run from repository root against a running local service:

```bash
BASE_URL="http://127.0.0.1:8080/v1" node tests/contract/test-contract.js
node tests/contract/test-idempotency-concurrency.js
node tests/contract/test-persistence-restart.js
```
