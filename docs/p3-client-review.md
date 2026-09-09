# P3 — Client Owner Review

**Reviewer**: Tori (Client Owner)
**Target**: https://pbse.kevinio.my.id
**Tanggal**: 9 September 2026
**Commit yang direview**: `f564ded4b1cdd9b7d24aa0629ce81511cca8c992`

## 1. Review Kontrak (Sudut Pandang Client Baru)

- Base URL: `https://pbse.kevinio.my.id/v1`
- Field wajib `POST /v1/orders`: `customerId`, `serviceType`, `weightKg`,
  `pickupAddress`: jelas terdokumentasi dengan pattern & enum eksplisit.
- Response sukses `201` disertai `Location` header dan representation
  lengkap; sesuai kontrak dan terverifikasi di live service.
- Ketentuan tolerant reader (unknown fields diabaikan, unknown enum aman)
  dinyatakan eksplisit di `info.description` dan deskripsi field `status`.
- Idempotency-Key dispesifikasikan lengkap: format UUID v4, retention
  24 jam, perilaku reuse dengan body sama/beda; semua dinyatakan di
  parameter description.

## 2. Hasil Request Client-Facing

| # | Request | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | GET /v1/orders/{id} | 200 | 200, body sesuai schema `Order` | ✅ PASS |
| 2 | GET /v1/orders | 200 | 200, array 2 order | ✅ PASS |
| 3 | GET ?status=pending_pickup | 200, terfilter | 200, tapi tidak dapat dibuktikan terfilter (semua data kebetulan berstatus sama) | ⚠️ PERLU RE-TEST |
| 4 | GET ?limit=5 | 200, dibatasi | 200, tidak dapat dibuktikan (jumlah data < limit) | ⚠️ PERLU RE-TEST |
| 5 | POST + Idempotency-Key | 201 | 201, `Location` header ada, body lengkap | ✅ PASS |
| 6 | POST tanpa key | 400 | 400, detail "Idempotency-Key header is required" | ✅ PASS |
| 7 | Malformed JSON | 400 | 400, application/problem+json | ✅ PASS |
| 8 | Order tidak ditemukan | 404 | 404, detail menyebut ID yang dicari | ✅ PASS |
| 9 | Idempotency conflict (key sama, body beda) | 201 lalu 409 | 201 lalu 409 `idempotency-conflict` | ✅ PASS |
| 10 | Cancellation | 200 | 200, body `Cancellation` lengkap | ✅ PASS |
| 11 | Invalid body (422) | 422, detail semua field invalid | 422, detail menyebut `serviceType`, `weightKg`, `pickupAddress` sekaligus | ✅ PASS |

Raw command + response lengkap: `docs/p3-client-review-raw.txt`

**Ringkasan: 9/11 PASS penuh, 2/11 tidak dapat diverifikasi secara meyakinkan dan bukan berarti gagal, tetapi terdapat keterbatasan data uji.**

## 3. Review Error & Retry

- [x] `400` vs `404` dibedakan jelas (test #7 vs #8)
- [x] `409` conflict dibedakan dari validation error (test #9)
- [x] `422` dibedakan dari `400`, validation-failed (semua field salah
      dilaporkan sekaligus) vs bad-request (malformed JSON/header hilang)
- [x] Problem Details (`type`, `title`, `status`, `detail`, `instance`)
      konsisten dan mudah dipahami tanpa baca kode service
- [x] Retry transient error (500/502/503/504) secara desain tetap
      memakai `Idempotency-Key` yang sama; dinyatakan eksplisit di
      kontrak, belum diuji langsung karena kondisi transient sulit
      disimulasikan dari sisi client
- [x] Client tidak perlu retry otomatis untuk `400/401/403/404/409/422`; semua kategori ini merepresentasikan kondisi yang tidak akan
      berubah hasilnya walau diulang

## 4. Temuan Ambiguity / Mismatch

1. **Filter dan pagination tidak dapat diverifikasi secara meyakinkan**
   karena data uji coba di live service kebetulan homogen (semua
   `pending_pickup`, jumlah order di bawah `limit` yang diuji). Ini
   bukan indikasi bug, spesifikasi parameter di kontrak sudah jelas
   (nama, default, maksimum), tetapi disarankan menambahkan beberapa
   order dengan status berbeda sebelum demo final, agar filter dan
   pagination punya bukti fungsional yang lebih kuat, tidak hanya bukti
   "tidak error".

2. **Test cancellation (test #10) membatalkan order yang dipakai di
   test #1** (`ord_MTUAXUC114063A`), menyebabkan status order tersebut
   berubah permanen menjadi `cancelled` setelah pengujian. Ini bukan
   masalah kontrak, tetapi catatan operasional: urutan testing perlu
   diperhatikan ke depannya supaya
   satu skenario tidak mengganggu validitas skenario lain yang memakai
   entity yang sama.

3. Endpoint `/v1/pickups` (GET) terdapat di kontrak, tetapi tidak termasuk dalam scope review ini karena todo P3 berfokus pada resource
   `Order`. Perlu dikonfirmasi ke Kevin apakah `/v1/pickups` termasuk
   scope demo P3 atau ditunda ke sesi berikutnya (relevan dengan item
   todo tertentu, yakni "Tentukan /v1/pickups tetap di luar scope P3 atau perlu
   dikerjakan").

Di luar tiga poin di atas, **no critical client ambiguity found** —
seluruh response Problem Details konsisten, dapat diandalkan client
tanpa asumsi tambahan di luar kontrak, dan seluruh status code yang
diuji (400, 404, 409, 422) berperilaku persis sesuai spesifikasi
Session 2.

## 5. Handoff

Hasil review ini dikirim ke Aya, Kevin, dan Faris untuk ditindaklanjuti
pada tahap contract drift review (Kevin).