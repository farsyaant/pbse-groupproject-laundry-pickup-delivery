# ADR 0003 - Autentikasi dan Kontrol Akses P4

- Status: Keputusan awal tahap 1 dengan pembaruan implementasi lokal tahap 3; belum mengklaim persetujuan seluruh tim.
- Penyusun: Aya (Client Owner Rotasi 2).
- Reviewer yang dituju: Kevin (Service Owner), Faris (Contract Owner), Tori (Integration Owner).
- Ruang lingkup: keputusan dan dokumentasi awal. Konfigurasi provider, perubahan kontrak, backend, client, CI, dan pengujian auth dikerjakan pada tahap berikutnya.

## Context

Update tahap 3: kontrak repository kini versi 1.0.0 dan sudah mendefinisikan scope
OAuth. Target konfigurasi dan status tenant dicatat di
[P4 Authorization Server](../p4-authorization-server.md). Implementasi tahap 3 memakai fallback Keycloak 26.7.3 lokal karena repo tidak
menyediakan tenant Auth0. Detail setup dan hasil verifikasi ada pada dokumen
tersebut; bagian tahap 1 di bawah dipertahankan sebagai catatan keputusan awal.

P4 menambahkan autentikasi pada hasil P3 Laundry Pickup & Delivery. Kontrak
`openapi.yaml` versi 0.2.1 masih memakai `security: []`. Service P3 menyediakan
read, create, dan cancellation order; `GET /pickups` ada di kontrak tetapi
belum diimplementasikan menurut ADR 0002. Folder client masih berupa kerangka.

Client yang direncanakan adalah dashboard web untuk staf, mobile untuk customer
dan driver, scanner loket, serta MCP assistant untuk customer. P4 juga meminta
klasifikasi scheduled job. Kemampuan menyimpan client secret ditentukan oleh
lingkungan eksekusi, bukan oleh ada/tidaknya pengguna manusia.

Role P4: Kevin sebagai Service Owner, Faris sebagai Contract Owner, Tori sebagai
Integration Owner, dan Aya sebagai Client Owner. Dokumen ini merupakan kontribusi
awal Client Owner dan bahan keputusan bersama, bukan klaim seluruh P4 selesai.

## Decision

### 1. Authorization server

Usulan tahap 1 adalah **Auth0 hosted**, dengan satu tenant khusus proyek dan satu
audience API laundry. Alasannya: dokumentasi provider menjelaskan Authorization
Code + PKCE serta refresh-token rotation dengan automatic reuse detection yang
mencabut token family, termasuk refresh token terbaru. Lihat
[Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
dan [SPA SDK](https://auth0.com/docs/libraries/auth0-single-page-app-sdk).

Ini pilihan rancangan, bukan tenant yang sudah tersedia. Pada tahap 3, tim perlu
memastikan akses tenant, batas paket yang dipakai, dukungan aplikasi M2M, dan
konfigurasi yang diperlukan. Jika tidak tersedia, evaluasi Keycloak dan revisi ADR
sebelum implementasi. Jangan menganggap perilaku reuse antar-provider identik.

Target rancangan: access token JWT bertanda tangan RS256, audience khusus API,
masa berlaku pendek (usulan 5 menit). Issuer dan JWKS diambil dari discovery
provider yang dipilih. API menggunakan access token, bukan ID token. Nilai
tenant, client ID, dan redirect URI produksi belum ditetapkan.

### 2. Klasifikasi seluruh client

| Client | Tipe dan batas kepercayaan | Flow yang direncanakan | Client secret | Cakupan |
|---|---|---|---|---|
| Web dashboard staf | Public; JavaScript berjalan di browser pengguna | Authorization Code + PKCE S256 | Tidak | Registrasi public client pada tahap 3; UI pada pertemuan berikutnya |
| Mobile customer/driver | Public; aplikasi terdistribusi dapat diperiksa pengguna | Authorization Code + PKCE S256 melalui system browser | Tidak, termasuk di bundle atau remote config | Registrasi public client pada tahap 3; UI pada pertemuan berikutnya |
| Scheduled job | Confidential jika dijalankan pada server yang dikelola tim | Client Credentials, sebagai identitas mesin | Ya, hanya secret manager atau runtime config server | Rancangan P4; tugas bisnis dan grant API masih perlu ditetapkan |
| Device scanner loket | Public secara default; provisioning saja tidak membuktikan secret aman | Usulan Device Authorization Grant jika tersedia pairing oleh staf | Tidak untuk rancangan public | Ditunda ke P11; tanpa pairing, desain identitas perangkat harus ditinjau ulang |
| MCP assistant milik customer | Public jika berjalan lokal/terdistribusi; confidential hanya untuk komponen server yang benar-benar menjaga secret | Usulan Authorization Code + PKCE untuk delegasi customer; server confidential juga melakukan autentikasi client | Tidak pada agent lokal; hanya server dapat menyimpan secret | Ditunda ke P12; topologi dan dukungan provider perlu dipastikan |

Scheduled job tidak mewakili customer. MCP yang bertindak atas nama customer
tidak boleh mengganti delegasi pengguna dengan Client Credentials. Device dan
MCP belum diregistrasikan dalam pekerjaan tahap 1.

### 3. PKCE, redirect URI, dan penyimpanan token

Keputusan rancangan untuk web/mobile:

1. Setiap login membuat `state`, OIDC `nonce`, dan `code_verifier` acak menggunakan
   generator kriptografis. Kirim `code_challenge` dengan metode S256.
2. Cocokkan `state` sekali pakai terhadap transaksi login. Gunakan SDK OIDC untuk
   validasi ID token, termasuk issuer, audience, expiry, dan `nonce`.
3. Daftarkan redirect URI lengkap per lingkungan: scheme, host, port jika ada,
   dan path harus cocok tepat. Tidak memakai wildcard, prefix match, atau URL
   redirect dari input pengguna. Callback final ditetapkan setelah host web dan
   application identifier mobile diketahui; belum ada URI yang diklaim aktif.
4. Web produksi menggunakan HTTPS. Mobile mengutamakan claimed HTTPS/app link
   yang terikat ke aplikasi. Callback development didaftarkan terpisah.
5. Tukarkan authorization code dengan verifier tanpa client secret. Password
   grant dan implicit flow tidak digunakan. Hapus data transaksi setelah selesai.

| Client | Kebijakan penyimpanan yang direncanakan |
|---|---|
| Web | Access/refresh token hanya di memori melalui SDK; tidak di localStorage, sessionStorage, URL, atau cookie yang bisa dibaca JavaScript. Reload dapat memerlukan login kembali. Memori tetap perlu dilindungi dari XSS. |
| Mobile | Access token di memori; refresh token di protected storage OS, misalnya Keychain atau penyimpanan terenkripsi dengan kunci di Android Keystore. Bukan plaintext preferences atau database antrean offline. |
| Scheduled job | Secret diinjeksi saat runtime di server; access token di memori. Minta token baru dengan Client Credentials saat kedaluwarsa, tanpa refresh token pengguna. |

Refresh token hanya dikirim ke token endpoint authorization server. Access token
dikirim ke API melalui header `Authorization`. Token dan header sensitif tidak
masuk log, analytics, screenshot bukti, atau output CI. Refresh dilakukan satu
per satu per sesi agar request paralel tidak menggunakan token lama bersamaan.
Antrean offline mobile menyimpan aksi dan Idempotency-Key, bukan token; token
valid dipasang saat pengiriman, dengan identitas pengguna antrean tetap diperiksa.

### 4. Scope vocabulary awal

Tabel ini merupakan input tahap 2 untuk Faris, **belum vocabulary final atau grant
yang aktif**. Scope mengikuti capability resource, bukan satu scope per endpoint.

| Scope usulan | Capability | Pemegang yang direncanakan | Dasar kontrak/domain |
|---|---|---|---|
| `orders:read` | Membaca collection/detail order yang diizinkan | Customer untuk miliknya; staf untuk outletnya | `listOrders`, `getOrder` |
| `orders:write` | Membuat dan membatalkan order sendiri sesuai state bisnis | Customer | `createOrder`, `cancelOrder` |
| `pickups:read` | Membaca pickup dalam kewenangan caller | Driver untuk penugasannya; staf untuk outletnya | `listPickups`, belum diimplementasikan di service |
| `orders:fulfil` | Mengelola pemrosesan order | Staf dalam outletnya | Domain saja; operasi belum ada di kontrak |
| `pickups:write` | Memperbarui status pickup yang ditugaskan | Driver | Domain saja; operasi belum ada di kontrak |

Web staf hanya meminta capability staf yang telah tersedia. Mobile customer
meminta `orders:read orders:write`; mobile driver meminta capability pickup yang
telah tersedia. Provider harus membatasi grant berdasarkan kewenangan pengguna;
scope yang diminta client tidak otomatis diberikan. Scheduled job, device, dan
MCP tidak mendapat grant tambahan sebelum kebutuhan operasinya disepakati.

`openid` digunakan untuk login OIDC; `offline_access` hanya bila perlu refresh
token. Keduanya bukan scope capability resource laundry. Scope untuk pembayaran,
delivery, atau outlet tidak ditambahkan hanya karena muncul sebagai contoh tugas.

Scope tidak menggantikan object authorization. `sub` harus dipetakan ke identitas
customer/driver/staf yang dipercaya server; `customerId` dari request bukan bukti
kepemilikan. Urutan yang direncanakan: authentication, scope check, lalu object
check. Aturan staf dibatasi outlet pada P4, sehingga berbeda dari deskripsi P3
yang menyebut staf dapat melihat semua order.

**Gap untuk handoff:** schema P3 belum memiliki relasi outlet atau pemetaan sub
ke identitas domain, dan belum ada operasi khusus staf maupun mutation pickup.
Contoh tugas `student` dipetakan ke Customer dan `courier` ke Driver. Kasus
collect delivery perlu dipadankan dengan domain Pickup bersama Faris/Kevin/Tori;
jangan mengklaim endpoint atau fixture tersebut sudah tersedia.

### 5. Perilaku client terhadap penolakan akses

| Status yang ditargetkan | Respons client |
|---|---|
| `401` | Bila sesi memiliki refresh token, coba satu refresh terkoordinasi lalu satu retry. Jika gagal, hapus sesi dan minta login; jangan membuat loop retry. |
| `403` | Tampilkan keterbatasan izin; tidak mencoba refresh/retry berulang untuk menaikkan scope. |
| `404` | Tampilkan pesan generik object tidak tersedia, baik tidak ada maupun bukan milik caller; jangan menebak keberadaan object. |

Retry mutation tetap memakai body dan Idempotency-Key semula. Ini kebijakan P4
yang akan ditinjau terhadap kontrak final, bukan hasil pengujian service saat ini.

### 6. Strategi test token

Rencana untuk Tori: gunakan signing key dan JWKS lokal khusus test agar CI tidak
bergantung pada tenant live. Buat key saat test berjalan, terbitkan hanya public
key pada JWKS, dan gunakan issuer/audience test yang berbeda dari produksi.
Verifier tetap menjalankan pemeriksaan signature, algoritma, issuer, audience,
dan expiry; jangan menambahkan jalur bypass autentikasi untuk test.

Fixture principal mencakup `student-a/b` (Customer), `courier-a/b` (Driver), dan
`staff-outlet-a/b` (Staf), dengan hubungan object yang eksplisit. Rencanakan token
valid, expired, salah issuer/audience, signature/payload diubah, serta scope
kurang. Uji 401/403/404 dan bandingkan body 404 absent versus not-owned. Penolakan
write harus memeriksa data tidak berubah; scope diperiksa sebelum query object.

JWT test lokal memverifikasi resource server, **tidak membuktikan refresh-token
rotation provider**. Bukti provider dilakukan terpisah oleh Aya dan Tori pada
tahap 10. Tidak ada test auth baru yang dijalankan atau diklaim lulus di tahap 1.

### 7. Refresh-token rotation dan reuse detection

**Status bukti: LULUS pada Keycloak lokal (17 September 2026).** Dokumentasi
provider menjadi dasar pilihan; bukti runtime tersimpan terpisah dan tidak berisi
nilai token.

Target setting tahap 3: rotation aktif untuk web/mobile; gunakan overlap period
0 detik untuk pengujian reuse yang tegas. Auth0 mendokumentasikan bahwa selama
overlap period, penggunaan ulang token sebelumnya dapat diizinkan tanpa memicu
deteksi. Lihat [Configure Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation).

Bukti tahap 10, diulang untuk web dan mobile dengan sesi uji terpisah:

| Langkah | Hasil yang harus dibuktikan | Hasil aktual tahap 10 |
|---|---|---|
| Login lalu gunakan RT1 untuk refresh | Sukses dan menerima RT2; perbandingan dalam memori menunjukkan RT2 berbeda dari RT1 | Lulus pada Keycloak lokal, web dan mobile (17 September 2026) |
| Gunakan RT1 kembali | Ditolak dan reuse terdeteksi | Lulus: `invalid_grant`, web dan mobile |
| Gunakan RT2 setelah reuse RT1 | Ditolak karena seluruh refresh-token family dicabut | Lulus: `invalid_grant`, web dan mobile |

Catatan bukti memuat waktu UTC, jenis client, setting provider yang telah
disanitasi, status/error aktual, event reuse yang relevan, dan hasil perbandingan
boolean. Jangan merekam nilai token atau raw token-endpoint response. Ketiga
baris telah berhasil dibuktikan pada Keycloak lokal; menolak RT1 saja memang belum
membuktikan family revocation.
Pemeriksaan runtime yang disanitasi ada di
[p4-refresh-rotation-verification.txt](../p4-refresh-rotation-verification.txt).
Pencabutan refresh-token family tidak berarti JWT access token yang sudah terbit
langsung tidak berlaku; masa berlaku pendek membatasi sisa masa penggunaannya.

## Alternatives Considered

| Alternatif | Pertimbangan |
|---|---|
| Keycloak lokal | Kandidat bila tim memerlukan kontrol konfigurasi lokal; perlu pengelolaan instance dan verifikasi perilaku family revocation pada versi/setting yang dipilih. |
| Membuat authorization server sendiri | Memperluas pekerjaan ke pengelolaan kredensial, issuance, rotation, dan reuse; tidak dipilih untuk penambahan auth P4. |
| Menyimpan secret pada web/mobile | Tidak memenuhi batas kepercayaan public client; secret yang didistribusikan bukan rahasia server. |
| Client Credentials untuk semua client | Tidak membawa delegasi pengguna untuk pembatasan object customer/driver. |
| Web memakai backend-for-frontend | Dapat memindahkan penyimpanan token ke server, tetapi menambah komponen; rancangan awal tetap public SPA sesuai klasifikasi P4. |

## Consequences

- Web/mobile tidak memerlukan client secret; implementasi perlu menangani PKCE,
  callback, masa berlaku token, dan login ulang dengan konsisten.
- Login/refresh bergantung pada provider hosted. Akses tenant dan batas paket
  harus dipastikan sebelum implementasi; test resource server tetap lokal.
- Storage memori web mengurangi persistensi sesi setelah reload. Mobile perlu
  protected storage dan koordinasi refresh saat koneksi intermiten.
- Autentikasi nantinya mengubah cara client P3 memanggil API. Faris menangani
  kompatibilitas dan kontrak pada tahap 4; dokumen ini tidak mengubah versi API.
- Relasi identitas, outlet, dan operasi yang belum tersedia perlu disepakati
  sebelum implementasi/pengujian object authorization dapat lengkap.
- Tahap 1 menghasilkan rancangan yang dapat direview. Bukti rotation/reuse
  tetap tertunda sampai tahap 10; belum ada persetujuan tim yang diklaim.

### Handoff setelah tahap 1

| Pemilik | Bahan tindak lanjut saat tahap terkait dimulai |
|---|---|
| Aya | Review klasifikasi, callback final, storage, dan least-privilege scope; koordinasi bukti provider dengan Tori. |
| Faris | Finalisasi scope dan pemetaan operasi pada tahap 2, lalu kontrak pada tahap 4. |
| Kevin | Review provider dan pemetaan identitas/object; konfigurasi serta backend pada tahap terkait. |
| Tori | Review fixture token/JWKS dan kriteria bukti; implementasi test pada tahap terkait. |

## Pembaruan Tahap 8–12 (Service Owner)

Bagian ini menutup **gap yang dicatat di atas** ("schema P3 belum memiliki relasi
outlet atau pemetaan sub ke identitas domain, dan belum ada operasi khusus staf
maupun mutation pickup") setelah implementasi backend selesai. Status: kontrak
`1.1.0`, service terautentikasi, seluruh test lulus.

### 8.1 Pemetaan sub → identitas domain

Klaim provider yang dipakai:

| Claim | Dipakai sebagai | Catatan |
|---|---|---|
| `sub` | `principal.subject` | identitas token |
| `fixture_domain_id` | `principal.domainId` | identitas domain (`cus_*`, `drv_*`, `outlet_*`); fallback ke `sub` |
| `outlet_id` | `principal.outletId` | hanya untuk staf; berasal dari provider, **tidak** dari request |
| `realm_access.roles` | `principal.roles` | `customer` / `driver` / `staff` |
| `scope` | `principal.scopes` | daftar capability |
| `jti` | `principal.tokenId` | bila tersedia |

`customerId` dari body atau URL **tidak pernah** diperlakukan sebagai bukti
kepemilikan.

### 8.2 Relasi outlet

`orders.outlet_id` (nullable) ditambahkan lewat migrasi in-place, sehingga
database P3 yang sudah ada tidak perlu dibuat ulang dan data P3 tidak hilang.
Order tanpa outlet tetap dapat dibaca oleh customer pemiliknya; staf dapat
menerima order yang belum terikat outlet, dan setelah terikat order tersebut
hanya dapat dijangkau oleh outlet yang memegangnya.

### 8.3 Operasi yang sebelumnya tidak ada di kontrak

| Operasi | Scope | Actor | Menggantikan contoh materi |
|---|---|---|---|
| `POST /v1/orders/{orderId}/fulfilment` | `orders:fulfil` | Staff | `POST /v1/orders/{orderId}/accept` |
| `POST /v1/pickups` | `orders:fulfil` | Staff | — (menugaskan driver) |
| `POST /v1/pickups/{pickupId}/collect` | `pickups:write` | Driver | `PATCH /v1/deliveries/{id}/collect` |

Resource kelompok ini adalah **Pickup** (bukan Delivery), sehingga padanan
`collect` memakai resource Pickup. Konsekuensinya `pickups:write` dan
`orders:fulfil` tidak lagi menjadi scope "hantu": masing-masing kini dipakai oleh
operasi nyata, sehingga jumlah scope (5) tetap jauh di bawah jumlah operasi (9).

### 8.4 Aturan kepemilikan final

| Objek | Aturan |
|---|---|
| Order (read) | customer pemilik **atau** staff outlet yang memegang order **atau** driver yang ditugaskan pada pickup order tersebut |
| Order (cancel) | hanya customer pemilik, dan hanya pada status `pending_pickup`/`ready_for_pickup`/`confirmed` |
| Order (fulfil / claim) | staff, hanya bila order belum terikat outlet **atau** sudah terikat outletnya sendiri |
| Pickup (dispatch) | staff, dengan aturan order yang sama seperti fulfil |
| Pickup (collect) | hanya `driver_id` yang tercatat pada pickup tersebut |
| Koleksi | dibatasi di dalam query SQL: customer `WHERE customer_id`, staff `WHERE outlet_id`, driver `WHERE driver_id` |

### 8.5 Strategi test token — realisasi

Strategi yang direncanakan di §6 direalisasikan di
`tests/helpers/harness.js`: key pair RS256 dibuat saat test berjalan, hanya public
key yang disajikan melalui JWKS lokal, dan issuer/audience test berbeda dari
produksi. Verifier tetap menjalankan seluruh pemeriksaan (signature, algoritma,
issuer, audience, expiry) — **tidak ada bypass autentikasi untuk test**.

Fixture 6 principal dengan relasi object eksplisit:

| Principal | domainId | outletId | scope |
|---|---|---|---|
| `student-a` | `cus_studentA` | — | `orders:read orders:write` |
| `student-b` | `cus_studentB` | — | `orders:read orders:write` |
| `courier-a` | `drv_courierA` | — | `pickups:read pickups:write` |
| `courier-b` | `drv_courierB` | — | `pickups:read pickups:write` |
| `staff-outlet-a` | `outlet_a` | `outlet_a` | `orders:read pickups:read orders:fulfil` |
| `staff-outlet-b` | `outlet_b` | `outlet_b` | `orders:read pickups:read orders:fulfil` |

### 8.6 Bukti empiris (bukan rencana)

| Klaim | Bukti |
|---|---|
| Empat negative test lulus, masing-masing boundary berbeda | `node tests/authz/test-authz.js` → `Authz tests passed` (36 pemeriksaan) |
| Test benar-benar menguji pemeriksaannya | `node tests/authz/verify-checks-are-live.js` → keempat boundary MERAH saat pemeriksaannya dinetralkan |
| `401` tanpa token / token diubah / expired / issuer-audience salah | `tests/authz/test-authz.js` |
| Absent vs not-owned identik (status + body) | pemeriksaan `deepEqual` body pada test 1, 2, dan 4 |
| Unauthorized write tidak mengubah database | test 2 membaca `status`/`collected_at` sebelum dan sesudah |
| Collection dibatasi di query | test 4 & test 2 membandingkan daftar milik outlet/driver sendiri |
| Contract test P3 tetap lulus | `node tests/contract/run-against-service.js` → 33/33 |
| Tidak ada token di log | pemeriksaan otomatis atas output service |
| `openapi.yaml` lint lulus | `npx @redocly/cli lint openapi.yaml` → valid, 0 error |

Rincian perintah dan keluaran ada di `service/EVIDENCE.md`.

### 8.7 Dampak terhadap Consequences di atas

- "Relasi identitas, outlet, dan operasi yang belum tersedia perlu disepakati
  sebelum implementasi/pengujian object authorization dapat lengkap" — **selesai**:
  relasi outlet, pemetaan identitas domain, dan operasi khusus staf/driver sudah
  tersedia dan teruji.
- "Autentikasi nantinya mengubah cara client P3 memanggil API" — terealisasi:
  kontrak naik ke `1.1.0` (perubahan kompatibel), dan contract test P3 kini
  menyuplai token melalui runner tanpa mengubah kontrak.
- Bukti refresh rotation (§7) tetap berlaku dan tidak berubah oleh pekerjaan ini.

Referensi lokal: [taksonomi client](../client-taxonomy.md),
[domain](../domain.md), [ADR P3](0002-implementasi.md),
[kontrak P3](../../openapi.yaml), dan [kebijakan kompatibilitas](../compatibility.md).
