# Handoff Kontrak API P4 (Contract Owner ke Tim)

- **Tanggal**: 16 September 2026
- **Penyusun**: Maulana Faris Al Ghifari (Faris — Contract Owner Rotasi 2)
- **Penerima Utama**: Kevin Antonio Wiyono Lauw (Service Owner) & Farsya Nabila Tori (Integration Owner)
- **Tembusan**: Ayasha Rahmadinni (Client Owner)
- **Versi Kontrak Final**: `1.0.0` (`openapi.yaml`)
- **Status Kompatibilitas**: Breaking Change (transisi dari unauthenticated P3 ke OAuth 2.0 / OIDC P4)
- **Hasil Redocly Lint**: `openapi.yaml: validated - Woohoo! Your API description is valid` (0 error)

---

## 1. Ringkasan Perubahan Kontrak P4

1. **Security Schemes (`components.securitySchemes.oauth2`)**:
   - Mendefinisikan OAuth 2.0 Authorization Server dengan dua flows:
     - `authorizationCode`: Authorization Code + PKCE (S256) untuk public client (Web & Mobile).
     - `clientCredentials`: Client Credentials flow untuk confidential client (Scheduled Job).
2. **Scope Vocabulary**:
   - 5 scope capability berformat `resource:action`: `orders:read`, `orders:write`, `pickups:read`, `orders:fulfil`, `pickups:write`.
3. **Pemisahan Tiga Lapisan Akses**:
   - Layer 1: Authentication (`401 Unauthorized` dengan header `WWW-Authenticate`).
   - Layer 2: Scope Enforcement (`403 Forbidden` dievaluasi sebelum query database).
   - Layer 3: Object Ownership Authorization (`404 Not Found` identik untuk absent vs not-owned).
4. **Public Health Endpoint**:
   - `GET /health` ditetapkan sebagai public endpoint dengan `security: []`.

---

## 2. Matriks Operasi, Scope, dan Hak Akses

| Method | Path | Operation ID | Security Requirement | Scope Wajib | Aktor yang Berhak |
|---|---|---|---|---|---|
| `GET` | `/health` | `healthCheck` | `[]` (Public) | - | Publik / Monitoring |
| `GET` | `/orders` | `listOrders` | `oauth2: [orders:read]` | `orders:read` | Customer (`student`), Staff (`staff-outlet`), Scheduled Job |
| `POST` | `/orders` | `createOrder` | `oauth2: [orders:write]` | `orders:write` | Customer (`student`) |
| `GET` | `/orders/{orderId}` | `getOrder` | `oauth2: [orders:read]` | `orders:read` | Customer (milik sendiri), Staff (outlet terkait) |
| `POST` | `/orders/{orderId}/cancellation` | `cancelOrder` | `oauth2: [orders:write]` | `orders:write` | Customer (milik sendiri & status cancellable) |
| `GET` | `/pickups` | `listPickups` | `oauth2: [pickups:read]` | `pickups:read` | Driver (`courier`), Staff (`staff-outlet`), Scheduled Job |

---

## 3. Scope Vocabulary & Pemetaan Pengguna Uji

| Scope | Deskripsi Capability | Role Mapping Keycloak | Test Users yang Diberikan |
|---|---|---|---|
| `orders:read` | Membaca koleksi dan detail pesanan dalam batas kewenangan caller | `customer`, `staff`, `machine` | `student-a`, `student-b`, `staff-outlet-a`, `staff-outlet-b`, `scheduled-job` |
| `orders:write` | Membuat pesanan baru dan membatalkan pesanan milik sendiri | `customer` | `student-a`, `student-b` |
| `pickups:read` | Membaca koleksi dan penugasan penjemputan cucian | `driver`, `staff`, `machine` | `courier-a`, `courier-b`, `staff-outlet-a`, `staff-outlet-b`, `scheduled-job` |
| `orders:fulfil` | Memproses pencucian dan pemenuhan pesanan laundry | `staff` | `staff-outlet-a`, `staff-outlet-b` |
| `pickups:write` | Memperbarui status penjemputan yang ditugaskan | `driver` | `courier-a`, `courier-b` |

---

## 4. Spesifikasi Kontrak Status Code

| Kondisi Request | HTTP Status | Response Header | Problem Type / Behavior |
|---|---|---|---|
| Request tanpa token `Authorization: Bearer` | `401` | `WWW-Authenticate: Bearer realm="Laundry API", error="invalid_token"` | `https://api.example.com/problems/unauthorized` |
| Token invalid, signature salah, atau expired | `401` | `WWW-Authenticate: Bearer realm="Laundry API", error="invalid_token"` | `https://api.example.com/problems/unauthorized` |
| Token valid, tetapi scope tidak mencukupi | `403` | - | `https://api.example.com/problems/forbidden` (Scope dicek sebelum DB disentuh) |
| Resource/object tidak ada dalam database | `404` | - | `https://api.example.com/problems/not-found` |
| Resource/object ada, tetapi bukan milik caller | `404` | - | **Wajib identik** dengan 404 absent (status, headers, dan problem body) |
| Endpoint `/health` saat service sehat | `200` | - | `{ "status": "ok" }` |

---

## 5. Instruksi Handoff untuk Service Owner (Kevin — Tahap 5 s.d. 9)

1. **Konfigurasi Startup & Fail-Fast Validation**:
   - Tambahkan variabel OIDC ke `service/src/config.js`:
     - `OIDC_ISSUER`
     - `OIDC_JWKS_URI`
     - `OIDC_AUDIENCE`
   - Service wajib gagal start (exit non-zero) bila salah satu variabel wajib tidak diisi.
2. **Struktur File Backend (`service/src/auth/`)**:
   - `verify.js`: Mengambil JWKS publik, memvalidasi signature RS256, `exp`, `iss`, dan `aud`.
   - `principal.js`: Memetakan claims JWT ke objek internal `req.principal = { id, role, scopes, outletId }`.
   - `authenticate.js`: Middleware autentikasi Layer 1 (membaca Bearer token, melempar 401 jika gagal).
   - `require-scope.js`: Middleware otorisasi Layer 2 (pengecekan scope, melempar 403 jika kurang).
   - `ownership.js`: Predicate otorisasi objek Layer 3.
3. **Urutan Pipeline Middleware**:
   ```text
   Request -> Authenticate (401) -> RequireScope (403) -> Load DB -> Ownership Check (404) -> Mutation/Response
   ```
4. **Pembatasan Koleksi**:
   - Pada `GET /v1/orders`, lakukan filter di level SQL (`WHERE customer_id = ?`), jangan me-load seluruh baris lalu memfilter di memori JavaScript.
5. **Redaksi Log**:
   - Redaksi header sensitif (`Authorization`, `Cookie`, `Set-Cookie`).
   - Jangan pernah mencatat token atau payload JWT ke console log atau error logger.

---

## 6. Instruksi Handoff untuk Integration Owner (Tori — Tahap 11 s.d. 12)

1. **Empat Negative Test Wajib (`tests/authz/`)**:
   - Skenario 1: `student-a` membaca order milik `student-b` -> Respon wajib `404 Not Found`.
   - Skenario 2: `courier-a` mencoba mutasi/collect pada delivery `courier-b` -> Respon wajib `404 Not Found`, database tidak boleh berubah.
   - Skenario 3: `student` memanggil operasi khusus staff (kurang scope) -> Respon wajib `403 Forbidden`.
   - Skenario 4: `staff-outlet-a` membaca order milik outlet B -> Respon wajib `404 Not Found`.
2. **Pengujian Tambahan**:
   - Request protected tanpa header `Authorization` -> `401 Unauthorized`.
   - Request dengan token yang payload atau signature-nya di-tamper -> `401 Unauthorized`.
   - Assert kesamaan respon 404: body JSON dan header dari objek yang tidak ada harus identik persis dengan objek yang bukan milik caller.
3. **CI Integration**:
   - Pastikan CI menjalankan `npm run test:contract` dan `npm run test:authz`.
   - Pastikan contract test P3 disuplai dengan token uji yang valid sehingga tetap lulus tanpa mengubah kontrak.

---

## 7. Addendum Implementasi (23 September 2026)

Ditulis oleh Service Owner setelah implementasi selesai, untuk menutup tiga hal
yang belum ada saat handoff: dua scope "hantu" (`orders:fulfil`, `pickups:write`)
belum dipakai operasi mana pun, belum ada operasi khusus staf, dan belum ada
mutasi pickup. Ketiganya dibutuhkan oleh empat negative test Step 11.

### 7.1 Operasi yang ditambahkan (kontrak `1.1.0`, kompatibel)

| Method | Path | Operation ID | Scope | Actor | Padanan contoh materi |
|---|---|---|---|---|---|
| `POST` | `/orders/{orderId}/fulfilment` | `fulfilOrder` | `orders:fulfil` | Staff | `POST /v1/orders/{orderId}/accept` |
| `POST` | `/pickups` | `createPickup` | `orders:fulfil` | Staff | — |
| `POST` | `/pickups/{pickupId}/collect` | `collectPickup` | `pickups:write` | Driver | `PATCH /v1/deliveries/{id}/collect` |

Klasifikasi perubahan menurut `docs/compatibility.md`: **compatible** (menambah
endpoint, menambah response field opsional `Order.outletId`, menambah header
`WWW-Authenticate` pada `403`). Bukan breaking change, sehingga versi naik
minor: `1.0.0` → `1.1.0`.

**Catatan untuk Contract Owner:** domain kelompok ini memakai resource **Pickup**
(lihat schema `Pickup` yang sudah ada sejak P3), bukan Delivery seperti pada
contoh materi. Karena itu operasi `collect` memakai resource Pickup. Scope
`pickups:write` yang sudah dideklarasikan pada `securitySchemes` kini benar-benar
dipakai, sehingga vocabulary scope tidak lagi memuat scope tanpa operasi.

### 7.2 Scope → operasi final (tidak ada scope hantu)

| Scope | Operasi |
|---|---|
| `orders:read` | `listOrders`, `getOrder` |
| `orders:write` | `createOrder`, `cancelOrder` |
| `pickups:read` | `listPickups` |
| `orders:fulfil` | `fulfilOrder`, `createPickup` |
| `pickups:write` | `collectPickup` |

Jumlah scope (5) tetap di bawah jumlah operasi protected (9). `orders:fulfil`
dipakai oleh dua operasi karena keduanya merupakan satu capability staf
("menerima pekerjaan order ke outlet"), bukan satu scope per endpoint.

### 7.3 Status code yang diimplementasikan

| Kondisi | Status | Layer |
|---|---|---|
| Token hilang / invalid / expired / issuer-audience salah | `401` | 1 |
| Token valid, scope kurang (mis. student pada `fulfilment`) | `403` | 2 |
| Objek tidak ada | `404` | 3 |
| Objek ada tetapi bukan milik caller | `404` (body identik) | 3 |
| `customerId` pada `createOrder` bukan identitas domain caller | `404` (body identik) | 3 |

`403` **tidak pernah** dipakai untuk object ownership, hanya untuk scope.
Sebaliknya, kegagalan ownership pada `createOrder` juga dijawab `404` agar tidak
membocorkan keberadaan identitas customer.

### 7.4 Aturan kepemilikan objek yang diimplementasikan

| Route | Aturan |
|---|---|
| `GET /orders` | customer: `WHERE customer_id = principal.domainId`; staff: `WHERE outlet_id = principal.outletId` |
| `GET /orders/{orderId}` | customer pemilik, atau staff outlet pemegang order, atau driver yang ditugaskan pada pickup order tersebut |
| `POST /orders` | hanya untuk `principal.domainId` sendiri |
| `POST /orders/{orderId}/cancellation` | hanya customer pemilik; status diperiksa setelah ownership |
| `POST /orders/{orderId}/fulfilment` | staff; order belum terikat outlet, atau terikat outletnya sendiri |
| `POST /pickups` | staff; aturan order sama seperti `fulfilment` |
| `POST /pickups/{pickupId}/collect` | hanya `pickup.driver_id` |
| `GET /pickups` | driver: `WHERE driver_id`; staff: pickup dari order di outletnya |

`outletId` dan `domainId` berasal dari claim provider, bukan dari request.

### 7.5 Bukti

Seluruh klaim di atas diverifikasi otomatis. Lihat `service/EVIDENCE.md` §9 untuk
daftar perintah dan hasilnya, serta `tests/authz/verify-checks-are-live.js` untuk
bukti bahwa keempat boundary benar-benar diuji (suite MERAH saat pemeriksaannya
dinetralkan).

Contract test P3 tetap lulus terhadap service terautentikasi (33/33) tanpa
mengubah kontrak; runner `tests/contract/run-against-service.js` yang menyuplai
bearer token, sesuai instruksi Step 12b.

### 7.6 Yang belum dikerjakan

Commit, tag `l4`, dan push sengaja tidak dilakukan (instruksi kerja sesi ini).
Perubahan ditinggalkan sebagai working tree pada branch `service-owner` untuk
direview Contract Owner dan Integration Owner.
