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

| Method | Path | Status |
|---|---|---|
| GET | `/health` | selesai |
| GET | `/v1/orders` | selesai |
| GET | `/v1/orders/{orderId}` | selesai |
| POST | `/v1/orders` | selesai |
| POST | `/v1/orders/{orderId}/cancellation` | selesai |
| GET | `/v1/pickups` | tidak masuk scope P3 |

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

| Kondisi | Status | Problem Type |
|---|---|---|
| JSON malformed | 400 | `bad-request` |
| Field wajib hilang | 400 | `bad-request` |
| Tipe field salah | 400 | `bad-request` |
| Order ID malformed | 400 | `bad-request` |
| Idempotency-Key hilang | 400 | `bad-request` |
| Idempotency-Key bukan UUID v4 | 400 | `bad-request` |
| Limit di luar range | 400 | `bad-request` |
| Status filter tidak valid | 400 | `bad-request` |
| Order tidak ditemukan | 404 | `not-found` |
| Idempotency key + body berbeda | 409 | `idempotency-conflict` |
| Cancellation status tidak diizinkan | 409 | `order-not-cancellable` |
| Domain validation gagal | 422 | `validation-failed` |
| Unexpected error | 500 | `internal-error` |

Semua error menggunakan `Content-Type: application/problem+json`.

## Persistence Check

```bash
# 1. Start service dan buat order
node src/app.js &
curl -X POST http://127.0.0.1:8080/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 423e4567-e89b-42d3-a456-426614174000" \
  -d '{"customerId":"cus_01HZX2Y1AB","serviceType":"wash_fold","weightKg":5.5,"pickupAddress":"Jl. Merdeka No. 10, Jakarta"}'

# 2. Catat order ID dari response

# 3. Stop service
kill %1

# 4. Start ulang dan GET order
node src/app.js &
curl http://127.0.0.1:8080/v1/orders/<order-id>

# 5. Data harus tetap ada
```

## Known Issues

- `GET /v1/pickups` belum diimplementasikan (tidak masuk scope P3).
- Authentication/authorization belum diimplementasikan (deferred per kontrak).
