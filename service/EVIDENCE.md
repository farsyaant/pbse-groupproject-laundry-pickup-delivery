# P4 Service Owner Evidence — Authentication & Access Control

**Peran:** Kevin Antonio Wiyono Lauw — Service Owner (Rotasi 2, P4)
**Fokus:** implementasi auth backend, OIDC config, middleware JWT, scope
enforcement, object authorization
**Referensi:** `CONTEXT-P4-AUTENTIKASI-DAN-KONTROL-AKSES.md` §5 Tahap 5–9, §9 Final Gate
**Branch:** `service-owner` (tidak ada commit/push dari sesi ini)

Dokumen ini mencatat **apa yang diimplementasikan, perintah yang dijalankan, dan
hasil verifikasinya**. Tidak ada token, refresh token, password, atau nilai
`.env` nyata yang direkam di sini.

---

## 1. Ringkasan Implementasi

| Tahap | Deliverable | Lokasi |
|---|---|---|
| 5 | Skeleton auth + validasi config OIDC fail-fast | `service/src/auth/`, `service/src/config.js` |
| 6 | Layer 1 authentication (JWKS, RS256, `exp`/`iss`/`aud`) | `service/src/auth/verify.js`, `authenticate.js`, `principal.js` |
| 7 | Layer 2 scope enforcement sebelum query | `service/src/auth/require-scope.js` |
| 8 | Layer 3 object authorization per handler | `service/src/auth/ownership.js`, `routes/*`, `store/*` |
| 8 | Koleksi dibatasi di dalam query SQL | `store/order-store.js`, `store/pickup-store.js` |
| 9 | Redaksi log `Authorization`/`Cookie`/`Set-Cookie` | `service/src/logger.js` |
| 4 | Operasi yang hilang untuk 4 boundary test | `openapi.yaml` (`createPickup`, `collectPickup`, `fulfilOrder`) |
| — | Migrasi in-place database P3 (`orders.outlet_id`, tabel `pickups`) | `service/src/database.js`, `service/db/schema.sql` |

Pemeriksaan tiga lapisan **terpisah** dan dijalankan berurutan:

```text
Request -> authenticate (401) -> requireScope (403) -> load object -> ownership (404) -> mutation/response
```

---

## 2. Bukti Konfigurasi Fail-Fast (Tahap 5)

```bash
cd service
OIDC_ISSUER= node src/app.js
```

Output:

```text
FATAL  Missing required environment variable: OIDC_ISSUER
```

Exit code non-zero: service tidak sempat melayani satu request pun dengan
konfigurasi OIDC yang tidak lengkap.

---

## 3. Bukti Tiga Status Berbeda (Tahap 6–8)

Dijalankan terhadap service lokal (`node src/app.js`) dengan token uji bertanda
tangan RS256. Nilai token tidak direkam.

| Kondisi | Layer | Hasil |
|---|---|---|
| `GET /v1/orders/{id}` tanpa header `Authorization` | 1 | `401` + `WWW-Authenticate: Bearer error="invalid_token"` |
| `GET /v1/orders/{id}` dengan token yang payload-nya diubah | 1 | `401` |
| `GET /v1/orders/{id}` dengan token expired | 1 | `401` |
| `GET /v1/orders/{id}` dengan token issuer/audience berbeda | 1 | `401` |
| Token `student` pada `POST /v1/orders/{id}/fulfilment` | 2 | `403` + `requiredScopes: ["orders:fulfil"]` |
| Token `student` pada `POST /v1/pickups` | 2 | `403` |
| `student-a` membaca order milik `student-b` | 3 | `404` (bukan `403`) |
| `staff-outlet-a` membaca order `outlet_b` | 3 | `404` |
| `courier-a` collect pickup milik `courier-b` | 3 | `404` + baris database tidak berubah |
| Order/pickup yang tidak ada | 3 | `404` dengan body **identik** |

Semua di atas diverifikasi otomatis oleh `tests/authz/test-authz.js`
(36 pemeriksaan, seluruhnya lulus).

---

## 4. Bukti Scope Dievaluasi Sebelum Query Database (Tahap 7)

Checkpoint P4 meminta: hentikan database, lalu ulangi request yang kurang scope —
harus tetap `403`, bukan `500`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  http://127.0.0.1:8080/v1/orders/ord_doesnotexist/fulfilment
# 403
```

Identifier yang bahkan tidak ada tetap menghasilkan `403`, yang membuktikan
scope check berjalan sebelum object di-load.

---

## 5. Bukti Koleksi Dibatasi di Dalam Query (Tahap 8d)

`order-store.listForPrincipal()` dan `pickup-store.listForPrincipal()`
menambahkan klausa `WHERE` berdasarkan principal:

```sql
-- customer
SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at, id LIMIT ?
-- staff
SELECT * FROM orders WHERE outlet_id = ? ORDER BY created_at, id LIMIT ?
-- driver
SELECT * FROM pickups WHERE driver_id = ? ORDER BY created_at, id LIMIT ?
```

Tidak ada baris milik principal lain yang pernah masuk ke process memory, dan
pagination tetap benar karena filter dilakukan di database, bukan di JavaScript.

Diverifikasi oleh pemeriksaan "collection is filtered in the query" pada
`tests/authz/test-authz.js`: daftar order `staff-outlet-a` tidak memuat order
`outlet_b`, dan daftar pickup `courier-a` tidak memuat pickup `courier-b`.

---

## 6. Bukti Refused Write Tidak Mengubah Data (Tahap 8c)

Test 2 menjalankan urutan berikut:

1. `staff-outlet-a` menugaskan pickup kepada `courier-b` (`POST /v1/pickups`) →
   `201`, `driverId: drv_courierB`.
2. Baca baris database: `status = 'assigned'`, `collected_at = NULL`.
3. `courier-a` memanggil `POST /v1/pickups/{id}/collect` → `404`.
4. Baca ulang baris database: `status = 'assigned'`, `collected_at = NULL`
   (**tidak berubah**).
5. `courier-b` memanggil endpoint yang sama → `200`, `status: 'picked_up'`.
6. Baca ulang: `status = 'picked_up'` (baru sekarang berubah).

Pemeriksaan status saja tidak cukup; langkah 2/4/6 membaca database langsung.

---

## 7. Bukti Tidak Ada Token di Log (Tahap 9)

`tests/authz/test-authz.js` menampung seluruh stdout+stderr service selama
pengujian, lalu memastikan:

- tidak ada token yang pernah diterbitkan muncul di output;
- tidak ada pola JWT (`eyJ...eyJ...`);
- tidak ada header `Authorization: Bearer <value>`.

Hasil: **lulus**. Log service hanya memuat method, path, status, correlation id,
dan alasan penolakan yang stabil, contoh:

```text
Rejected bearer token { method: 'GET', path: '/v1/orders', status: 401, reason: 'ERR_JWT_CLAIM_VALIDATION_FAILED' }
```

Tidak ada nilai token, tidak ada payload JWT, tidak ada header mentah.

---

## 8. Bukti Empat Boundary Benar-Benar Diuji (Tahap 11c)

Test yang tetap hijau saat pemeriksaannya dihapus tidak menguji apa pun. Untuk
membuktikan sebaliknya, `tests/authz/verify-checks-are-live.js` menjalankan
kembali suite authz dengan satu predicate dinetralkan pada satu waktu, lalu
memastikan suite menjadi **MERAH** karena alasan yang tepat:

| Pemeriksaan dinetralkan | Hasil |
|---|---|
| `mayReadOrder` (test 1) | suite MERAH pada `test 1: student-a reading student-b order -> 404` |
| `requireScope` (test 3) | suite MERAH pada `test 3: student token on staff-only fulfilment -> 403` |
| Dimensi outlet pada `mayReadOrder` (test 4) | suite MERAH pada `test 4: staff-outlet-a reading outlet B order -> 404` |
| `mayCollectPickup` (test 2) | suite MERAH pada `test 2: courier-a collecting courier-b pickup -> 404` |
| Semua dipulihkan | suite HIJAU kembali |

Fault injection hidup **di dalam test harness** (`tests/helpers/disable-check.js`,
di-load via `--require`) dan hanya aktif bila `AUTHZ_DISABLE_CHECK` diset. Tidak
ada jalur bypass, flag, atau `if (NODE_ENV === 'test')` di dalam kode service.

---

## 9. Hasil Perintah Verifikasi

Dijalankan dari root repository:

```bash
node tests/authz/test-authz.js
# Authz tests passed  (36 pemeriksaan)

node tests/contract/test-contract.js
# Total Passed: 28   Total Failed: 0   Result: SUCCESS   (terhadap Prism mock)

node tests/contract/run-against-service.js
# Total Passed: 33   Total Failed: 0   Result: SUCCESS   (terhadap service terautentikasi)

node tests/contract/test-persistence-restart.js
# {"createdIds":[...3 id...],"restoredIds":[...3 id yang sama...]}

node tests/contract/test-idempotency-concurrency.js
# {"requestCount":5,"statuses":[201,201,201,201,201],"uniqueIds":["ord_..."],"databaseRows":1}

node tests/contract/check-legacy-migration.js
# orders columns: ... ,outlet_id
# tables: cancellations,idempotency_records,orders,pickups
# legacy row preserved: {"id":"ord_p3legacy","outlet_id":null}

npx @redocly/cli lint openapi.yaml
# Woohoo! Your API description is valid. (0 error)

node tests/authz/verify-checks-are-live.js
# All four boundaries are proven to be genuinely exercised.
```

Contract suite P3 dijalankan ulang terhadap service terautentikasi **tanpa
mengubah kontrak**: yang berubah hanya runner-nya, yang kini mengirim bearer
token (`tests/contract/run-against-service.js`). Operasi yang lulus di P3 tetap
lulus.

---

## 10. Ringkasan Bukti Checklist Service Owner (P4 §6)

| Kriteria Bukti | Hasil |
|---|---|
| `OIDC_*` ditambahkan ke `.env.example` dan config validation | Lulus (fail-fast terbukti) |
| Struktur `service/src/auth/` dibuat | `verify.js`, `principal.js`, `authenticate.js`, `require-scope.js`, `ownership.js` |
| Verifikasi token berbasis JWKS | Lulus (`jose` `createRemoteJWKSet`, JWKS dibangun sekali di module level) |
| `req.principal` dibentuk | `{ subject, domainId, outletId, kind, roles, scopes, tokenId }` |
| Authentication middleware terpasang | `app.use(authenticate)` sebelum seluruh route `/v1` |
| Scope middleware terpasang pada route | Seluruh 9 operasi memakai `requireScope(...)` sesuai `openapi.yaml` |
| Ownership predicate diimplementasikan | `mayReadOrder`, `mayCancelOrder`, `mayCreateOrder`, `mayClaimOrder`, `mayFulfilOrder`, `mayCollectPickup` |
| Object check sebelum mutation | Lulus (refused write tidak mengubah data) |
| Collection dibatasi di query | Lulus (`WHERE` di SQL, bukan filter di JavaScript) |
| Token diredaksi dari log | Lulus (scan output service bersih) |
| Service P3 tetap kompatibel | Lulus (contract suite 33/33 terhadap service terautentikasi) |
| Membantu Tori menyediakan endpoint/fixture untuk test | `POST /orders/{id}/fulfilment`, `POST /pickups`, `POST /pickups/{id}/collect`, fixture 6 principal di `tests/helpers/harness.js` |
| Menjalankan full test dan memperbaiki error | Lulus (authz, contract, persistence, concurrency, lint) |

---

## 11. Yang Belum Dikerjakan (bukan bagian Service Owner)

- **Commit, tag `l4`, dan push** — sesuai instruksi, tidak dilakukan dari sesi
  ini. Perubahan sengaja ditinggalkan sebagai working tree pada branch
  `service-owner`.
- **Bukti refresh-token rotation/reuse** terhadap Keycloak live (Tahap 10) —
  milik Aya & Tori; statusnya sudah tercatat di
  `docs/decisions/0003-autentikasi.md` dan
  `docs/p4-refresh-rotation-verification.txt`.
- **Deployment ulang ke `pbse.kevinio.my.id`** — perlu `.env` OIDC produksi pada
  server, di luar cakupan sesi ini.
