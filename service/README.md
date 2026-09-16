# Laundry Pickup & Delivery — Service

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

Service gagal start jika variable wajib kosong.

## Database

Schema diterapkan otomatis saat startup. Untuk membuat database dari kosong:

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

Health check: `http://127.0.0.1:8080/health`

## Daftar Endpoint

| Method | Path | Security | Scope Wajib | Status |
|---|---|---|---|---|
| GET | `/health` | Public (`security: []`) | - | Selesai (P3) |
| GET | `/v1/orders` | OAuth2 Bearer | `orders:read` | Selesai (P3 baseline) |
| GET | `/v1/orders/{orderId}` | OAuth2 Bearer | `orders:read` | Selesai (P3 baseline) |
| POST | `/v1/orders` | OAuth2 Bearer | `orders:write` | Selesai (P3 baseline) |
| POST | `/v1/orders/{orderId}/cancellation` | OAuth2 Bearer | `orders:write` | Selesai (P3 baseline) |
| GET | `/v1/pickups` | OAuth2 Bearer | `pickups:read` | Belum masuk scope P3/P4 backend |

## Scope Vocabulary (P4)

Scope dirancang dengan format `resource:action` merepresentasikan capability aktor, konsisten antara `openapi.yaml`, Authorization Server (Keycloak), dan kode backend:

| Scope | Deskripsi Capability | Pemegang Utama | Operation di Kontrak |
|---|---|---|---|
| `orders:read` | Membaca daftar dan detail laundry order dalam kewenangan caller | Customer (`student`), Staff (`staff-outlet`), Scheduled Job | `listOrders`, `getOrder` |
| `orders:write` | Membuat order baru dan membatalkan order milik caller | Customer (`student`) | `createOrder`, `cancelOrder` |
| `pickups:read` | Membaca daftar dan detail penjemputan cucian | Driver (`courier`), Staff (`staff-outlet`), Scheduled Job | `listPickups` |
| `orders:fulfil` | Mengelola pemrosesan order dan pemenuhan cucian | Staff (`staff-outlet`) | Operasi domain staf |
| `pickups:write` | Memperbarui status penjemputan cucian yang ditugaskan | Driver (`courier`) | Operasi domain kurir |

## Object Ownership Rules (P4)

Backend menerapkan tiga lapisan pemeriksaan akses secara terpisah dan berurutan:
1. **Layer 1 - Authentication**: Verifikasi token JWT via JWKS (`exp`, `iss`, `aud`, RS256). Gagal -> `401 Unauthorized` dengan header `WWW-Authenticate`.
2. **Layer 2 - Scope Check**: Verifikasi token memiliki scope yang dibutuhkan. Evaluasi dilakukan **sebelum query database dijalankan**. Gagal -> `403 Forbidden`.
3. **Layer 3 - Object Ownership Check**: Verifikasi caller berwenang atas data/objek spesifik.

### Aturan Kepemilikan Per Route

| Route | Predicate & Aturan Akses Objek | Penolakan Bukan Milik |
|---|---|---|
| `GET /v1/orders` | Customer hanya melihat order miliknya (`WHERE customer_id = principal.id`). Staff melihat order dalam kewenangan outletnya. Pembatasan wajib dilakukan di query database, bukan filter memori. | - (list difilter di query) |
| `POST /v1/orders` | Customer hanya boleh membuat order untuk dirinya sendiri (`body.customerId === principal.id`). Mencegah pembuatan order atas nama identitas lain. | `403 Forbidden` / `422` jika subject tidak cocok |
| `GET /v1/orders/{orderId}` | Order di-load dari DB. Jika order tidak ada -> 404. Jika order milik user lain -> **404 Not Found identik** (mencegah probing keberadaan resource). | `404 Not Found` |
| `POST /v1/orders/{orderId}/cancellation` | Order di-load dari DB. Jika tidak ada atau bukan milik caller -> **404 Not Found identik** (TIDAK return 403!). Mutasi pembatalan dan pengecekan status hanya dieksekusi setelah ownership terbukti valid. | `404 Not Found` |
| `GET /v1/pickups` | Driver hanya melihat penjemputan miliknya (`WHERE driver_id = principal.id`). Staff melihat penjemputan outletnya. Filter diterapkan pada query database. | - (list difilter di query) |

Bukti pengujian curl dan JSON output lengkap dapat dilihat di [EVIDENCE.md](EVIDENCE.md).

## Contoh Request

### GET /health

```bash
curl -i http://127.0.0.1:8080/health
```

### GET single order

```bash
curl -i http://127.0.0.1:8080/v1/orders/ord_seed001
```

### GET collection

```bash
curl -i http://127.0.0.1:8080/v1/orders
curl -i "http://127.0.0.1:8080/v1/orders?status=pending_pickup"
curl -i "http://127.0.0.1:8080/v1/orders?limit=10"
```

### POST order

```bash
curl -i -X POST http://127.0.0.1:8080/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 423e4567-e89b-42d3-a456-426614174000" \
  -d '{"customerId":"cus_01HZX2Y1AB","serviceType":"wash_fold","weightKg":5.5,"pickupAddress":"Jl. Merdeka No. 10, Jakarta"}'
```

### POST cancellation

```bash
curl -i -X POST http://127.0.0.1:8080/v1/orders/ord_seed001/cancellation \
  -H "Idempotency-Key: 523e4567-e89b-42d3-a456-426614174001"
```

## Failure Mapping

| Kondisi | Status | Problem Type | Catatan / Header |
|---|---|---|---|
| Token hilang, invalid, expired, signature salah | 401 | `unauthorized` | `WWW-Authenticate: Bearer realm="Laundry API", error="..."` |
| Token valid tapi scope kurang | 403 | `forbidden` | Evaluasi scope mendahului query database |
| Order tidak ditemukan | 404 | `not-found` | Resource absent |
| Order ada tapi bukan milik caller | 404 | `not-found` | Resource not-owned (body identik dengan absent) |
| JSON malformed | 400 | `bad-request` | - |
| Field wajib hilang | 400 | `bad-request` | - |
| Tipe field salah | 400 | `bad-request` | - |
| Order ID malformed | 400 | `bad-request` | - |
| Idempotency-Key hilang | 400 | `bad-request` | - |
| Idempotency-Key bukan UUID v4 | 400 | `bad-request` | - |
| Limit di luar range | 400 | `bad-request` | - |
| Status filter tidak valid | 400 | `bad-request` | - |
| Idempotency key + body berbeda | 409 | `idempotency-conflict` | - |
| Cancellation status tidak diizinkan | 409 | `order-not-cancellable` | - |
| Domain validation gagal | 422 | `validation-failed` | Problem extension `invalidFields` |
| Unexpected error | 500 | `internal-error` | - |

Semua error menggunakan `Content-Type: application/problem+json`.

## Persistence Check

Automated check for the assignment requirement: create three entities, restart
the service, then read all three entities from SQLite:

```bash
node tests/contract/test-persistence-restart.js
```

Expected output contains three `createdIds` and the same three `restoredIds`.

Manual equivalent:

```bash
# 1. Start service dan buat tiga order dengan tiga Idempotency-Key berbeda
node src/app.js &
curl -X POST http://127.0.0.1:8080/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 423e4567-e89b-42d3-a456-426614174000" \
  -d '{"customerId":"cus_01HZX2Y1AB","serviceType":"wash_fold","weightKg":5.5,"pickupAddress":"Jl. Merdeka No. 10, Jakarta"}'

# 2. Catat tiga order ID dari response

# 3. Stop service
kill %1

# 4. Start ulang dan GET ketiga order
node src/app.js &
curl http://127.0.0.1:8080/v1/orders/<order-id-1>
curl http://127.0.0.1:8080/v1/orders/<order-id-2>
curl http://127.0.0.1:8080/v1/orders/<order-id-3>

# 5. Data harus tetap ada
```

## Known Issues

- `GET /v1/pickups` belum diimplementasikan (tidak masuk scope P3).
- Authentication menggunakan bearer JWT dari Keycloak. Set `OIDC_ISSUER`,
  `OIDC_JWKS_URI`, dan `OIDC_AUDIENCE` pada environment sebelum menjalankan
  service.
- `GET /v1/orders` hanya mengembalikan order milik subject token. Detail dan
  cancellation order yang bukan milik caller dikembalikan sebagai `404` yang
  sama dengan order yang tidak ada.
- Ownership rule saat ini: customer hanya dapat membaca atau membatalkan order
  dengan `customer_id` yang sama dengan `principal.subject`, dan hanya dapat
  membuat order untuk subject-nya sendiri. Akses staff per outlet menunggu
  relasi outlet yang belum tersedia pada schema P3.
- `invalidFields` dikirim sebagai extension Problem Details pada error validasi request.

## P3 Verification Commands

Run from repository root against a running local service:

```bash
BASE_URL="http://127.0.0.1:8080/v1" node tests/contract/test-contract.js
DATABASE_FILE="./service/db/laundry.sqlite" node tests/contract/test-idempotency-concurrency.js
node tests/contract/test-persistence-restart.js
```

The concurrency check reports request statuses, one unique order ID, and one
database row. Authz tests are run with:

```bash
node tests/authz/test-authz.js
```
