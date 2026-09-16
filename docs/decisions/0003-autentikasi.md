# ADR 0003 - Autentikasi dan Kontrol Akses P4

- Status: Usulan keputusan awal tahap 1; belum disahkan bersama tim atau diimplementasikan.
- Penyusun: Aya (Client Owner Rotasi 2).
- Reviewer yang dituju: Kevin (Service Owner), Faris (Contract Owner), Tori (Integration Owner).
- Ruang lingkup: keputusan dan dokumentasi awal. Konfigurasi provider, perubahan kontrak, backend, client, CI, dan pengujian auth dikerjakan pada tahap berikutnya.

## Context

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

**Status bukti: BELUM DIUJI.** Tenant/client belum dikonfigurasi pada pekerjaan ini.
Dokumentasi provider menjadi dasar pilihan, bukan bukti runtime proyek.

Target setting tahap 3: rotation aktif untuk web/mobile; gunakan overlap period
0 detik untuk pengujian reuse yang tegas. Auth0 mendokumentasikan bahwa selama
overlap period, penggunaan ulang token sebelumnya dapat diizinkan tanpa memicu
deteksi. Lihat [Configure Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation).

Rencana bukti tahap 10, diulang untuk web dan mobile dengan sesi uji terpisah:

| Langkah | Hasil yang harus dibuktikan | Hasil aktual tahap 1 |
|---|---|---|
| Login lalu gunakan RT1 untuk refresh | Sukses dan menerima RT2; perbandingan dalam memori menunjukkan RT2 berbeda dari RT1 | Belum diuji |
| Gunakan RT1 kembali | Ditolak dan reuse terdeteksi | Belum diuji |
| Gunakan RT2 setelah reuse RT1 | Ditolak karena seluruh refresh-token family dicabut | Belum diuji |

Catatan bukti nantinya memuat waktu UTC, jenis client, setting provider yang telah
disanitasi, status/error aktual, event reuse yang relevan, dan hasil perbandingan
boolean. Jangan merekam nilai token atau raw token-endpoint response. Ketiga
baris harus berhasil dibuktikan; menolak RT1 saja belum membuktikan family revocation.
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

Referensi lokal: [taksonomi client](../client-taxonomy.md),
[domain](../domain.md), [ADR P3](0002-implementasi.md),
[kontrak P3](../../openapi.yaml), dan [kebijakan kompatibilitas](../compatibility.md).
