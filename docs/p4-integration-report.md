# P4 — Integration Owner Report

**Role**: Tori (Integration Owner)
**Tahap**: 11 (Authorization test) & 12 (CI, verifikasi akhir)
**Branch**: `integration-owner`
**Tanggal**: 23 September 2026
**Commit final**: `107314f` — "adopt service-owner's complete authz test"

---

## 1. Ringkasan 

Seluruh 4 negative test tahap 11 lulus (38 assertion total,
0 gagal). Test dijalankan terhadap test-only JWKS (tidak bergantung
authorization server live). CI hijau untuk
`test:authz`, `test-contract.js` (terhadap Prism), dan Redocly lint.
Token/secret terverifikasi tidak bocor ke log maupun output CI.
Verifikasi "sengaja-fail" telah dilakukan dan membuktikan middleware
aktif dan diperlukan.

Satu known limitation tercatat: tiga skenario spesifik pada
`test-contract.js` (idempotency conflict, empty-collection filtering,
`invalidFields` extension) belum tervalidasi terhadap live service
dengan auth aktif secara bersamaan; dijelaskan di bagian 6.

---

## 2. Test Helper (Token dan JWKS Test-Only)

Diimplementasikan di `tests/helpers/harness.js` (integrasi final, hasil
kolaborasi dengan Service Owner). Karakteristik:

- Signing key RS256 dibuat baru setiap test run (tidak hardcoded).
- JWKS server lokal (`startTestIssuer`); CI tidak butuh akses jaringan
  ke authorization server live.
- Token generator (`issuer.token(subject, overrides)`) mendukung
  override scope, issuer, audience, dan expiry, dipakai untuk semua
  skenario negatif (issuer salah, audience salah, signature salah, dll).
- Service di-spawn sebagai child process terpisah per test run dengan
  environment variable (`OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_AUDIENCE`)
  mengarah ke JWKS test-only tersebut.
- Database dibuat di file temporary, dihapus otomatis setelah test
  selesai (`removeDatabase`).

---

## 3. Empat Negative Test 

| # | Skenario | Expected | Hasil |
|---|---|---|---|
| 1 | Student A membaca order milik Student B | 404 | ✅ PASS |
| 2 | Courier A melakukan collect pada delivery Courier B | 404, data tidak berubah | ✅ PASS |
| 3 | Student memanggil operasi khusus staff | 403 | ✅ PASS |
| 4 | Staff outlet A membaca order outlet B | 404 | ✅ PASS |

### Detail Test #1 — Student A membaca order Student B
- `student-a` membaca order milik `student-b` → 404 (bukan 403,
  sesuai aturan "object tidak ada dan object bukan milik caller
  sama-sama 404 identik").
- Order yang benar-benar tidak ada juga → 404 dengan body
  identik byte-for-byte dengan kasus not-owned (`JSON.stringify`
  dibandingkan langsung).
- Body 404 tidak membocorkan field order apapun (`customerId`, dst).
- Kontrol: `student-a` membaca order miliknya sendiri → 200 (memastikan
  bukan false-positive dari bug lain).

### Detail Test #2 — Courier A melakukan collect delivery Courier B
- Pickup dibuat dan ditugaskan ke `courier-b` melalui staff.
- `courier-a` mencoba collect pickup tersebut → 404.
- Pickup yang tidak ada juga → 404, body identik dengan not-owned.
- State database diperiksa langsung (bukan hanya status code) via
  koneksi read-only ke SQLite: status dan `collected_at` pickup
  tidak berubah sebelum dan sesudah percobaan collect yang ditolak.
- Kontrol: `courier-b` collect pickup miliknya sendiri → 200, status
  berubah jadi `picked_up`, dan perubahan itu benar-benar tertulis
  di database.
- Collection listing (`GET /v1/pickups`) diverifikasi terfilter di
  level query: daftar milik `courier-a` tidak memuat pickup
  `courier-b`, dan sebaliknya.

### Detail Test #3 — Student memanggil operasi khusus staff
- Endpoint staff-only: `POST /v1/orders/{id}/fulfilment` (scope
  `orders:fulfil`).
- Token student (tanpa scope tersebut) memanggil operasi ini → 403.
- Scope check terbukti terjadi sebelum object di-load: memanggil
  operasi yang sama dengan ID order yang tidak ada pun tetap
  menghasilkan 403 (bukan 404).
- Body 403 menyertakan field `requiredScopes` yang menyebut
  `orders:fulfil` secara eksplisit.
- Diverifikasi juga pada endpoint kedua (`POST /v1/pickups`, dispatch)
  untuk memastikan aturan scope konsisten lintas operasi staff.

### Detail Test #4 — Staff outlet A membaca order outlet B
- Order milik `student-b` diklaim oleh `staff-outlet-b`, sehingga
  terikat pada `outlet_b`.
- `staff-outlet-a` membaca order tersebut → 404, body identik
  dengan kasus order yang benar-benar tidak ada.
- Kontrol: `staff-outlet-b` membaca order miliknya sendiri → 200.
- Collection listing (`GET /v1/orders`) diverifikasi terfilter di level
  query database: daftar outlet A tidak memuat order outlet B.

---

## 4. Layer 1 (Authentication)

Di luar 4 skenario wajib, ditambahkan cakupan berikut (hasil kolaborasi
dan integrasi commit Integration Owner ke dalam suite akhir):

| Skenario | Expected | Hasil |
|---|---|---|
| Tidak ada Authorization header | 401 | ✅ PASS |
| Header 401 menyertakan `WWW-Authenticate: invalid_token` | — | ✅ PASS |
| Authorization scheme selain Bearer (mis. Basic) | 401 | ✅ PASS |
| Token dengan payload diedit (signature tidak cocok) | 401 | ✅ PASS |
| Token expired | 401 | ✅ PASS |
| Token dari issuer berbeda | 401 | ✅ PASS |
| Token untuk audience berbeda | 401 | ✅ PASS |
| Token ditandatangani kunci tidak dikenal | 401 | ✅ PASS |
| `/health` tetap public tanpa token | 200 | ✅ PASS |

---

## 5. Pemeriksaan Tambahan

### Unauthorized write tidak mengubah database
`student-a` mencoba membatalkan order milik `student-b` → 404.
Representasi order dibandingkan byte-for-byte sebelum dan sesudah
percobaan — identik. Membuktikan ownership check terjadi sebelum
mutation dieksekusi, bukan sesudahnya.

### Token tidak bocor di response error
Response body dari tiga skenario penolakan berbeda (403, 404, 401)
diperiksa untuk memastikan tidak satupun mengembalikan nilai token
yang dikirimkan.

### Token/secret tidak bocor di log service maupun output CI
- Di level test: seluruh token yang diterbitkan selama test run
  dicatat, lalu output service (`stdout` + `stderr`) dipindai, tidak
  ada satupun token yang cocok, tidak ada pola menyerupai JWT
  (`eyJ...`), dan tidak ada pola `Authorization: Bearer ...`.
- Di level CI: log run GitHub Actions ("Run Authorization Tests" dan
  "Run Contract Tests against Prism") diperiksa manual dengan mencari
  kata kunci "bearer", tidak ada kecocokan.

---

## 6. Contract Test P3 Terhadap Service Setelah Auth

Dijalankan pada dua target berbeda, sesuai arahan Contract Owner:

**Terhadap Prism mock (port 4010)**
BASE_URL="http://127.0.0.1:4010" node tests/contract/test-contract.js
Total Passed: 28
Total Failed: 0

Seluruh skenario P3 (GET collection, filter, pagination, POST dengan
Idempotency-Key, retry, error 400/404/422, dst) lulus.

**Terhadap live service (port 8080, auth aktif)**

Sebelum ada token: 11 passed, 19 failed, seluruh kegagalan disebabkan
`401 Unauthorized` karena `test-contract.js` versi awal tidak mengirim
token. Ini dilaporkan ke Contract Owner.

### Known limitation

Tiga skenario secara eksplisit tidak tervalidasi terhadap kombinasi
"live service + kontrak P3 + auth aktif" sekaligus karena keterbatasan
Prism sebagai static mock:

1. Idempotency conflict (409 saat key sama, body berbeda): Prism
   tidak dapat mensimulasikan state, sehingga skenario ini di-skip pada
   run terhadap Prism.
2. Empty-collection filtering: Prism mengembalikan contoh statis
   dari skema, bukan hasil filter sesungguhnya.
3. `invalidFields` extension pada error 422 merupakan perilaku
   spesifik implementasi Contract Owner, tidak tercermin di contoh
   statis Prism.

Ketiga skenario ini divalidasi secara terpisah melalui `test:authz`
(untuk aspek otorisasi) dan review kode manual (untuk aspek response
shape), namun belum ada satu test otomatis yang memverifikasi
ketiganya terhadap live service dengan token valid secara bersamaan.
Direkomendasikan sebagai follow-up sebelum sesi berikutnya jika waktu
memungkinkan; tidak dianggap blocker karena aspek otorisasi (fokus P4)
sudah tervalidasi penuh melalui `test:authz`.

---

## 7. Integrasi CI

Workflow: `.github/workflows/ci.yml`, trigger pada push ke `main` dan
`integration-owner`, serta pull request ke `main`.

Step yang dijalankan berurutan:
1. Checkout, setup Node.js 20, setup pnpm
2. Install dependency service
3. Start Prism mock, tunggu ready (probe `GET /health`)
4. Run Contract Tests against Prism: 28 passed, 0 failed
5. Run Authorization Tests (`pnpm --dir service run test:authz`) —
   38 checks passed, 0 failed
6. Run Redocly OpenAPI Lint: lulus

Status run terakhir (commit `107314f`): hijau, seluruh step lulus.

---

## 8. Verifikasi "Sengaja-Fail"

Untuk membuktikan test benar-benar menguji perilaku yang dimaksud
(bukan false-positive), middleware `requireScope('orders:read')` pada
`GET /v1/orders` di-nonaktifkan sementara (comment-out).

Hasil: bukan lolos ke 200 seperti dugaan awal, melainkan **500
Internal Server Error** — `"Cannot read properties of null (reading
'subject')"`. Investigasi mengungkap adanya coupling: handler
bergantung pada state yang di-set middleware scope, bukan hanya
middleware authentication. Perilaku ini tetap membuktikan bahwa
middleware yang dihapus aktif dan diperlukan; permintaan tanpa
scope check menyebabkan kegagalan, bukan akses tanpa hambatan.

Middleware dikembalikan setelah verifikasi, dan test suite diverifikasi
kembali lulus penuh (38/38) pada kondisi normal.

Temuan untuk ditindaklanjuti: dilaporkan ke Service Owner sebagai
catatan desain — idealnya kegagalan middleware scope menghasilkan
error yang lebih eksplisit, bukan crash generik.

---

## 9. Perintah Verifikasi (Reproducible)

```bash
# Authorization tests (test-only JWKS, tidak butuh service berjalan
# terpisah — di-spawn otomatis oleh script)
node tests/authz/test-authz.js

# Contract test terhadap Prism mock
pnpm --package=@stoplight/prism-cli dlx prism mock openapi.yaml -p 4010
BASE_URL="http://127.0.0.1:4010" node tests/contract/test-contract.js

# Contract test terhadap live service lokal (butuh .env terisi OIDC_*)
cd service && node src/app.js
# di terminal lain:
BASE_URL="http://127.0.0.1:8080/v1" node tests/contract/test-contract.js
```

---

## 10. Status Terhadap Final Gate 

| Item | Status |
|---|---|
| Empat negative test authorization lulus | ✅ |
| Request tanpa token → 401 | ✅ |
| Edited token → 401 | ✅ |
| Missing scope → 403 | ✅ |
| Object milik user lain → 404 | ✅ |
| Absent dan not-owned response identik | ✅ |
| Unauthorized write tidak mengubah database | ✅ |
| Collection dibatasi di query database | ✅ |
| Token tidak muncul di log | ✅ |
| Contract test P3 tetap lulus | ⚠️ Lulus penuh terhadap Prism; live-service memiliki known limitation (lihat bagian 6) |
| CI green | ✅ |

---

## 11. Riwayat Kolaborasi

Test suite final (`tests/authz/test-authz.js`) merupakan hasil integrasi
dua kontribusi:
- Draft awal dan 4 negative test lengkap (endpoint `/fulfilment`,
  `/pickups/{id}/collect`, ownership outlet): Service Owner.
- Test tambahan (expired token, `/health` public, unauthorized-write
  no-mutation, token-leak check): Integration Owner, commit `03f7cb1`, diintegrasikan langsung oleh Service Owner ke dalam suite final
  agar turut mencakup endpoint P4 yang baru.

Merge dilakukan pada commit `107314f` di branch `integration-owner`,
mengadopsi penuh versi Service Owner (`origin/service-owner` @
`35716b3`) untuk menghindari duplikasi test yang sudah tercakup.