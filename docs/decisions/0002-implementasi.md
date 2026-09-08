# ADR 0002 — Implementasi Service P3

## Context

Session 3 memerlukan implementasi service yang mengikuti kontrak OpenAPI 0.2.0 untuk Laundry Pickup & Delivery. Service harus mendukung order lifecycle, idempotency, dan error handling sesuai RFC 9457.

## Decision

- **Runtime**: Node.js dengan Express.
- **Database**: SQLite via better-sqlite3.
- **Idempotency**: Disimpan di tabel `idempotency_records` dalam SQLite. Record berlaku 24 jam.
- **ID Generation**: Server-generated dengan prefix (`ord_`, `can_`) + timestamp base36 + random hex.
- **Error Format**: application/problem+json sesuai RFC 9457.

## Alternatives Considered

| Alternatif | Alasan Tidak Dipilih |
|---|---|
| PostgreSQL | Terlalu berat untuk scope P3 akademik |
| Redis untuk idempotency | Menambah dependency, SQLite cukup untuk single-instance |
| UUID untuk order ID | Kontrak menggunakan prefix pattern `ord_[A-Za-z0-9]+` |

## Consequences

- SQLite hanya mendukung single-writer, cocok untuk single-instance deployment.
- WAL mode diaktifkan untuk performa baca.
- Schema diterapkan secara idempotent saat startup (`IF NOT EXISTS`).

## Hosting Provider

Belum dipilih untuk P3.

## Idempotency Storage

Tabel `idempotency_records` di SQLite dengan kolom:
- `key` (PK) — UUID v4 dari client
- `body_hash` — SHA-256 dari request body
- `request_status` — processing / completed / failed
- `response_status` — HTTP status code
- `response_body` — JSON response
- `created_at` / `expires_at` — lifecycle 24 jam

## Scope dan Deviasi

### Endpoint yang diimplementasikan
- `GET /health`
- `GET /v1/orders`
- `GET /v1/orders/{orderId}`
- `POST /v1/orders`
- `POST /v1/orders/{orderId}/cancellation`

### Endpoint yang belum diimplementasikan
- `GET /v1/pickups` — tidak masuk scope P3.

### Deviasi dari openapi.yaml
- Tidak ada deviasi. Semua response mengikuti schema yang didefinisikan di kontrak.
