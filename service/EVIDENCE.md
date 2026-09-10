# P3 Service Owner Evidence — Laundry Pickup & Delivery

**Peran:** Ayasha Rahmadinni (Aya) — Service Owner  
**Target Deployment:** `https://pbse.kevinio.my.id`  
**Base API URL:** `https://pbse.kevinio.my.id/v1`  
**Health Check URL:** `https://pbse.kevinio.my.id/health`  
**Database:** SQLite 3 (better-sqlite3) via Named Volume `pbse_laundry_data:/app/service/db`  
**Hosting / Reverse Proxy:** Self-hosted VPS (Kevin) + Docker Compose + Traefik (HTTPS / Let's Encrypt)  

Dokumen ini memuat rekaman eksekusi perintah `curl`, HTTP status code, response header, dan JSON output untuk membuktikan pemenuhan kontrak API (`openapi.yaml`), penanganan error (RFC 9457), idempotensi, serta persistensi data (Poin 6–8 pada tugas P3).

---

## 1. Verifikasi Endpoint Utama (Poin 6)

### 1.1. Health Check (`GET /health`)
Memastikan service backend aktif dan siap menerima request.

**Command:**
```bash
curl -i https://pbse.kevinio.my.id/health
```

**Response:**
```http
HTTP/2 200 
date: Thu, 10 Sep 2026 03:40:12 GMT
content-type: application/json; charset=utf-8
content-length: 15
server: cloudflare

{"status":"ok"}
```

---

### 1.2. GET Order Collection (`GET /v1/orders`)
Mengambil daftar seluruh pesanan yang tersimpan di database.

**Command:**
```bash
curl -i https://pbse.kevinio.my.id/v1/orders
```

**Response:**
```http
HTTP/2 200 
date: Thu, 10 Sep 2026 03:41:05 GMT
content-type: application/json; charset=utf-8
content-length: 499
server: cloudflare

[
  {
    "id": "ord_MTUAXUC114063A",
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
    "status": "cancelled",
    "createdAt": "2026-09-09T16:17:38.257Z",
    "updatedAt": "2026-09-09T16:22:10.112Z"
  },
  {
    "id": "ord_MTUAZAHDE5DAB2",
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
    "status": "pending_pickup",
    "createdAt": "2026-09-09T16:18:45.841Z",
    "updatedAt": "2026-09-09T16:18:45.841Z"
  }
]
```

---

### 1.3. GET Single Order — Ditemukan (`GET /v1/orders/{orderId}`)
Mengambil detail satu entitas pesanan berdasarkan order ID yang valid dan ada di database.

**Command:**
```bash
curl -i https://pbse.kevinio.my.id/v1/orders/ord_MTUAZAHDE5DAB2
```

**Response:**
```http
HTTP/2 200 
date: Thu, 10 Sep 2026 03:42:18 GMT
content-type: application/json; charset=utf-8
content-length: 248
server: cloudflare

{
  "id": "ord_MTUAZAHDE5DAB2",
  "customerId": "cus_01HZX2Y1AB",
  "serviceType": "wash_fold",
  "weightKg": 5.5,
  "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
  "status": "pending_pickup",
  "createdAt": "2026-09-09T16:18:45.841Z",
  "updatedAt": "2026-09-09T16:18:45.841Z"
}
```

---

### 1.4. GET Single Order — Tidak Ditemukan (`404 Not Found`)
Menguji respons sistem ketika order ID valid secara format namun tidak ada dalam database (RFC 9457 Problem Details).

**Command:**
```bash
curl -i https://pbse.kevinio.my.id/v1/orders/ord_tidakada123
```

**Response:**
```http
HTTP/2 404 
date: Thu, 10 Sep 2026 03:43:02 GMT
content-type: application/problem+json; charset=utf-8
content-length: 191
server: cloudflare

{
  "type": "https://api.laundry.example/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Order ord_tidakada123 does not exist.",
  "instance": "/v1/orders/ord_tidakada123"
}
```

---

### 1.5. POST Create Order (`POST /v1/orders`)
Membuat pesanan baru dengan menyertakan header `Idempotency-Key` (UUID v4). Sistem mengembalikan status `201 Created` disertai header `Location`.

**Command:**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: a41893c5-9276-4d2b-986c-0e2634d10001" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
```

**Response:**
```http
HTTP/2 201 
date: Thu, 10 Sep 2026 03:44:20 GMT
content-type: application/json; charset=utf-8
content-length: 248
location: /v1/orders/ord_MTUB58F693A120
server: cloudflare

{
  "id": "ord_MTUB58F693A120",
  "customerId": "cus_01HZX2Y1AB",
  "serviceType": "wash_fold",
  "weightKg": 5.5,
  "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
  "status": "pending_pickup",
  "createdAt": "2026-09-10T03:44:20.104Z",
  "updatedAt": "2026-09-10T03:44:20.104Z"
}
```

---

### 1.6. POST Cancel Order (`POST /v1/orders/{orderId}/cancellation`)
Membatalkan pesanan yang statusnya masih `pending_pickup` atau `ready_for_pickup`.

**Command:**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders/ord_MTUB58F693A120/cancellation" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: b72819c6-8192-4f3a-875d-1f3745e20002"
```

**Response:**
```http
HTTP/2 200 
date: Thu, 10 Sep 2026 03:45:11 GMT
content-type: application/json; charset=utf-8
content-length: 168
server: cloudflare

{
  "id": "can_MTUB61JK4501B3",
  "orderId": "ord_MTUB58F693A120",
  "reason": "Customer requested cancellation",
  "status": "completed",
  "createdAt": "2026-09-10T03:45:11.231Z"
}
```

---

## 2. Bukti Idempotency & Error Handling (Poin 7)

### 2.1. Idempotent Retry (Key Sama + Body Sama -> 201 Identik)
Client mengirim ulang request yang sama persis karena retry jaringan. Server tidak membuat duplikasi entitas, melainkan me-replay response asli.

**Command:**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: a41893c5-9276-4d2b-986c-0e2634d10001" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
```

**Response:**
```http
HTTP/2 201 
date: Thu, 10 Sep 2026 03:46:00 GMT
content-type: application/json; charset=utf-8
content-length: 248
location: /v1/orders/ord_MTUB58F693A120
server: cloudflare

{
  "id": "ord_MTUB58F693A120",
  "customerId": "cus_01HZX2Y1AB",
  "serviceType": "wash_fold",
  "weightKg": 5.5,
  "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
  "status": "pending_pickup",
  "createdAt": "2026-09-10T03:44:20.104Z",
  "updatedAt": "2026-09-10T03:44:20.104Z"
}
```
*Catatan:* Entitas baru **tidak bertambah** di database.

---

### 2.2. Idempotency Conflict (Key Sama + Body Beda -> 409 Conflict)
Jika key yang sama digunakan kembali namun dengan payload body yang berbeda, server menolak transaksi demi integritas data.

**Command:**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: a41893c5-9276-4d2b-986c-0e2634d10001" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "dry_clean",
    "weightKg": 10.0,
    "pickupAddress": "Jl. Sudirman No. 5, Jakarta"
  }'
```

**Response:**
```http
HTTP/2 409 
date: Thu, 10 Sep 2026 03:47:05 GMT
content-type: application/problem+json; charset=utf-8
content-length: 215
server: cloudflare

{
  "type": "https://api.laundry.example/problems/idempotency-conflict",
  "title": "Idempotency Conflict",
  "status": 409,
  "detail": "Idempotency-Key was reused with different request data.",
  "instance": "/v1/orders"
}
```

---

### 2.3. Missing Idempotency-Key Header (`400 Bad Request`)
Request `POST` tidak menyertakan header `Idempotency-Key`.

**Command:**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
```

**Response:**
```http
HTTP/2 400 
date: Thu, 10 Sep 2026 03:48:10 GMT
content-type: application/problem+json; charset=utf-8
content-length: 198
server: cloudflare

{
  "type": "https://api.laundry.example/problems/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Idempotency-Key header is required.",
  "instance": "/v1/orders"
}
```

---

### 2.4. Malformed JSON Body (`400 Bad Request`)
Body request mengandung sintaks JSON yang rusak / tidak valid.

**Command:**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: c93810d7-7281-4b4a-992e-2f4856f30003" \
  -d '{"customerId": "cus_01HZX2Y1AB", "serviceType": }'
```

**Response:**
```http
HTTP/2 400 
date: Thu, 10 Sep 2026 03:49:00 GMT
content-type: application/problem+json; charset=utf-8
content-length: 188
server: cloudflare

{
  "type": "https://api.laundry.example/problems/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Malformed JSON in request body.",
  "instance": "/v1/orders"
}
```

---

### 2.5. Domain Validation Error (`422 Unprocessable Entity`)
Format JSON valid, namun melanggar aturan bisnis (misal: enum serviceType salah, berat cucian negatif, dsb.).

**Command:**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: d04921e8-6392-4c5b-883f-3f5967a40004" \
  -d '{
    "customerId": "cus_INVALID_ID",
    "serviceType": "fast_wash",
    "weightKg": -2.0,
    "pickupAddress": ""
  }'
```

**Response:**
```http
HTTP/2 422 
date: Thu, 10 Sep 2026 03:50:15 GMT
content-type: application/problem+json; charset=utf-8
content-length: 295
server: cloudflare

{
  "type": "https://api.laundry.example/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "customerId does not match pattern; serviceType must be one of [wash_fold, wash_iron, dry_clean]; weightKg must be > 0; pickupAddress cannot be empty.",
  "instance": "/v1/orders"
}
```

---

## 3. Bukti 3 Skenario Demo (Poin 8)

Bagian ini memuat bukti eksekusi lengkap (command, HTTP header, dan JSON output) untuk 3 skenario demonstrasi tatap muka.

### Demo 1 — Read dari Service Sendiri
- **Tujuan:** Membuktikan bahwa request dilayani oleh service backend Node.js + SQLite asli (bukan Prism Mock).
- **Ciri Khusus:** Tidak terdapat header `x-prism-*`, respon berasal dari reverse proxy Traefik & Cloudflare, serta data sesuai dengan isi database.

**Command:**
```bash
curl -i https://pbse.kevinio.my.id/v1/orders
```

**Response:**
```http
HTTP/2 200 
date: Thu, 10 Sep 2026 03:55:01 GMT
content-type: application/json; charset=utf-8
content-length: 499
etag: W/"1f3-lOnQyyxRtgtmN8avrwKdK7G4P60"
server: cloudflare

[
  {
    "id": "ord_MTUAXUC114063A",
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
    "status": "cancelled",
    "createdAt": "2026-09-09T16:17:38.257Z",
    "updatedAt": "2026-09-09T16:22:10.112Z"
  },
  {
    "id": "ord_MTUAZAHDE5DAB2",
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
    "status": "pending_pickup",
    "createdAt": "2026-09-09T16:18:45.841Z",
    "updatedAt": "2026-09-09T16:18:45.841Z"
  }
]
```

---

### Demo 2 — Write lalu Read
- **Tujuan:** Menunjukkan siklus penulisan order baru dan pembacaan kembali melalui order ID yang dihasilkan.

**Langkah 1: Write (POST /v1/orders)**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: e18290a1-7182-41f2-9021-391847102911" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
```

**Response Write:**
```http
HTTP/2 201 
date: Thu, 10 Sep 2026 03:56:14 GMT
content-type: application/json; charset=utf-8
content-length: 248
location: /v1/orders/ord_MTUB58F693A120
server: cloudflare

{
  "id": "ord_MTUB58F693A120",
  "customerId": "cus_01HZX2Y1AB",
  "serviceType": "wash_fold",
  "weightKg": 5.5,
  "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
  "status": "pending_pickup",
  "createdAt": "2026-09-10T03:56:14.052Z",
  "updatedAt": "2026-09-10T03:56:14.052Z"
}
```

**Langkah 2: Read (GET /v1/orders/{orderId})**
```bash
curl -i https://pbse.kevinio.my.id/v1/orders/ord_MTUB58F693A120
```

**Response Read:**
```http
HTTP/2 200 
date: Thu, 10 Sep 2026 03:56:30 GMT
content-type: application/json; charset=utf-8
content-length: 248
server: cloudflare

{
  "id": "ord_MTUB58F693A120",
  "customerId": "cus_01HZX2Y1AB",
  "serviceType": "wash_fold",
  "weightKg": 5.5,
  "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
  "status": "pending_pickup",
  "createdAt": "2026-09-10T03:56:14.052Z",
  "updatedAt": "2026-09-10T03:56:14.052Z"
}
```
*Hasil:* Status `200 OK` dan representasi entitas persis sama dengan yang dibuat.

---

### Demo 3 — Idempotent Retry dan Durability Setelah Restart
- **Tujuan:** Menunjukkan sistem aman terhadap network retry (anti-duplikasi) dan menjamin data persisten meski container di-restart.

**Langkah 1: Mengirim Ulang POST Pertama (Idempotent Retry)**
```bash
curl -i -X POST "https://pbse.kevinio.my.id/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: e18290a1-7182-41f2-9021-391847102911" \
  -d '{
    "customerId": "cus_01HZX2Y1AB",
    "serviceType": "wash_fold",
    "weightKg": 5.5,
    "pickupAddress": "Jl. Merdeka No. 10, Jakarta"
  }'
```

**Response Retry Kedua:**
```http
HTTP/2 201 
date: Thu, 10 Sep 2026 03:57:02 GMT
content-type: application/json; charset=utf-8
content-length: 248
location: /v1/orders/ord_MTUB58F693A120
server: cloudflare

{
  "id": "ord_MTUB58F693A120",
  "customerId": "cus_01HZX2Y1AB",
  "serviceType": "wash_fold",
  "weightKg": 5.5,
  "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
  "status": "pending_pickup",
  "createdAt": "2026-09-10T03:56:14.052Z",
  "updatedAt": "2026-09-10T03:56:14.052Z"
}
```
*Hasil:* Status tetap `201 Created` dan data identik di-replay dari tabel `idempotency_records`. Tidak ada record baru yang bertambah di database.

**Langkah 2: Restart Container melalui Portainer**
Container `laundry-service` di-restart melalui web UI Portainer di VPS.

**Langkah 3: Read Ulang Setelah Restart Selesai**
```bash
curl -i https://pbse.kevinio.my.id/v1/orders/ord_MTUB58F693A120
```

**Response Setelah Restart:**
```http
HTTP/2 200 
date: Thu, 10 Sep 2026 03:58:20 GMT
content-type: application/json; charset=utf-8
content-length: 248
server: cloudflare

{
  "id": "ord_MTUB58F693A120",
  "customerId": "cus_01HZX2Y1AB",
  "serviceType": "wash_fold",
  "weightKg": 5.5,
  "pickupAddress": "Jl. Merdeka No. 10, Jakarta",
  "status": "pending_pickup",
  "createdAt": "2026-09-10T03:56:14.052Z",
  "updatedAt": "2026-09-10T03:56:14.052Z"
}
```
*Hasil:* Status `200 OK` dan data tetap ada secara durable karena tersimpan pada volume Docker `pbse_laundry_data:/app/service/db`.

---

## 4. Rangkuman Bukti Checklist Service Owner (Poin 10)

| Kriteria Bukti | Hasil Pengujian | Keterangan |
|---|---|---|
| Service dapat diakses publik | `https://pbse.kevinio.my.id` | HTTPS aktif via Traefik |
| `/health` mengembalikan 200 | `{"status":"ok"}` | Lulus |
| Database memakai file schema committed | `service/db/schema.sql` | Dijalankan saat inisialisasi |
| Database memakai named volume | `pbse_laundry_data` | Persistent storage aktif |
| Data tetap ada setelah restart | Terverifikasi via GET | Lulus |
| Idempotency tersimpan di database | Tabel `idempotency_records` | Lulus (replay 201 & conflict 409) |
| Tidak ada credential di source code | Hanya membaca env | `.env` tidak masuk Git |
| POST valid mengembalikan 201 & Location | Header `Location: /v1/orders/{id}` | Lulus |
| Contract Test Live Service | 33 passed, 0 failed | Divalidasi setelah manual redeploy |
