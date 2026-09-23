# P4 Tahap 3 - Authorization Server Lokal

Provider implementasi: **Keycloak 26.7.3**. Auth0 pada ADR tahap 1 masih usulan;
repo tidak menyediakan tenant atau akses Auth0. Fallback lokal dipakai agar setup
dapat direproduksi tanpa akun hosted. Server lokal sudah berjalan; hasil pemeriksaan live dicatat di bagian
verifikasi. Backend laundry tidak diubah.

## Menjalankan

Prasyarat: Docker Desktop aktif dan Node.js >= 20. Jalankan dari root repository:

```bash
node auth/keycloak/prepare.mjs
docker compose --env-file auth/keycloak/.runtime/.env -f docker-compose.auth.yml up -d
node tools/oidc-discovery.mjs http://localhost:8081/realms/laundry
node auth/keycloak/verify.mjs
```

Tunggu startup Keycloak selesai sebelum menjalankan kedua pemeriksaan. Persiapan
membuat password admin, enam password user, dan secret scheduled job secara acak.
Nilainya hanya disimpan pada `auth/keycloak/.runtime/credentials.json`, dengan
permission file 0600 dan direktori 0700. Folder runtime diabaikan Git dan build
image service. Tidak ada credential pada public client atau output command.

Admin console: http://localhost:8081/admin/ dengan username `laundry-admin`.
Password dibaca secara privat dari file runtime. Jangan tempel isinya ke chat,
commit, screenshot, atau log. Jangan hapus volume untuk melakukan restart.

```bash
docker compose --env-file auth/keycloak/.runtime/.env -f docker-compose.auth.yml stop
docker compose --env-file auth/keycloak/.runtime/.env -f docker-compose.auth.yml start
```

Realm diimpor saat startup pertama. Keycloak melewati import jika realm sudah
ada; menjalankan generator kembali mempertahankan credential yang ada. Perubahan
konfigurasi setelah import harus diterapkan melalui admin/API, bukan menganggap
file generator otomatis mengubah realm live. Jangan menghapus runtime selama
volume masih memakai password/secret lama.

## Realm dan discovery

| Item | Nilai lokal |
|---|---|
| Realm | `laundry` |
| Issuer | `http://localhost:8081/realms/laundry` |
| Discovery | `http://localhost:8081/realms/laundry/.well-known/openid-configuration` |
| JWKS | `http://localhost:8081/realms/laundry/protocol/openid-connect/certs` |
| Audience | `laundry-api` |
| Authorization endpoint | `http://localhost:8081/realms/laundry/protocol/openid-connect/auth` |
| Token endpoint | `http://localhost:8081/realms/laundry/protocol/openid-connect/token` |
| Signature / access token lifespan | RS256 / 300 detik |
| SSO idle / maximum lifespan | 30 menit / 8 jam |
| Refresh rotation | `revokeRefreshToken=true`, `refreshTokenMaxReuse=0` |

HTTP hanya untuk development pada loopback `127.0.0.1:8081`. Ini bukan deployment
produksi dan bukan URL yang dapat dipakai telepon fisik. Deployment berikutnya
memerlukan hostname HTTPS yang dapat dijangkau service/client. Jangan mengganti
issuer sepihak pada verifier; nilainya harus cocok persis dengan token.

Tiga variabel tersedia di `service/.env.example`. Isi `.env` lokal service dengan
issuer, JWKS, dan audience di atas jika service berjalan langsung pada host.
Service di container memerlukan routing provider yang mempertahankan issuer;
konfigurasi produksi tidak diubah pada tahap ini.

## Deployment Railway

Keycloak dan resource server berjalan sebagai dua service Railway terpisah,
pada **akun/project yang berbeda**. Karena private networking tidak menembus
batas project, resource server menjangkau provider melalui domain publik.

| Item | Nilai Railway |
|---|---|
| Keycloak origin | `https://keycloak-production-68f0.up.railway.app` |
| Issuer | `https://keycloak-production-68f0.up.railway.app/realms/laundry` |
| JWKS | `https://keycloak-production-68f0.up.railway.app/realms/laundry/protocol/openid-connect/certs` |
| Resource server | `https://pbse.kevinio.my.id` |
| Audience | `laundry-api` |

### Variabel environment resource server

```env
OIDC_ISSUER=https://keycloak-production-68f0.up.railway.app/realms/laundry
OIDC_JWKS_URI=https://keycloak-production-68f0.up.railway.app/realms/laundry/protocol/openid-connect/certs
OIDC_AUDIENCE=laundry-api
```

`OIDC_AUDIENCE` **bukan** URL: nilainya adalah nama audience API yang
didaftarkan pada mapper realm (`included.custom.audience`), dan harus sama persis
dengan string itu.

`OIDC_ISSUER` harus memakai **domain publik** Keycloak, karena verifier
membandingkan string ini dengan claim `iss` yang diterbitkan Keycloak dari
`KC_HOSTNAME`. Jika kedua service berada dalam project Railway yang sama,
`OIDC_JWKS_URI` boleh memakai private domain
(`http://<service>.railway.internal:<port>/...`) karena hanya dipanggil oleh
resource server; issuer tetap wajib publik agar browser/mobile client dapat
melakukan login. JWKS harus menunjuk realm dan path yang sama.

**Jebakan:** bila kedua service berada pada project/akun berbeda, host
`*.railway.internal` **tidak akan resolve**. Gejalanya adalah `401` untuk
**setiap** token, termasuk token yang sah, karena pengambilan JWKS gagal terus
dan tidak pernah ter-cache. Gunakan domain publik pada kasus itu.

Setelah mengubah variabel, service harus di-restart/redeploy: environment
variable hanya dibaca saat startup.

### Urutan deploy

Realm diimpor saat startup Keycloak pertama. Deployment Keycloak **tidak** akan
membuat realm jika file import tidak tersedia pada container, dan resource
server akan menolak setiap token (401) selama realm belum ada.

1. Pastikan Keycloak hidup: `/realms/master/.well-known/openid-configuration`
   harus menjawab `200`. Path `/` menampilkan admin console dan tidak membuktikan
   realm proyek sudah ada.
2. Verifikasi realm proyek:
   `/realms/laundry/.well-known/openid-configuration`. Jawaban `404` berarti
   realm belum diimpor.
3. Jalankan `node auth/keycloak/import.mjs <keycloak-origin>`. Ini membuat realm
   bila belum ada, dan memperbaiki client scope (`basic`, `roles`,
   `laundry-identity`) beserta atribut user bila realm sudah ada.
4. Setelah realm ada, ambil `issuer` dan `jwks_uri` dari discovery document dan
   isi kedua variabel di atas pada service resource server, lalu redeploy.
5. Verifikasi dari luar: `GET https://pbse.kevinio.my.id/v1/orders` tanpa token
   harus menjawab `401` dengan header `WWW-Authenticate`.
6. Verifikasi bahwa token asli **diterima**, bukan hanya ditolak:
   `node auth/keycloak/e2e-proof.mjs` terhadap Keycloak lokal, atau login manual
   lalu `GET /v1/orders` dengan token tersebut.

Langkah 6 penting: service yang menolak **semua** token (termasuk yang asli) juga
menjawab `401`, sehingga langkah 5 saja tidak membedakan konfigurasi yang benar
dari yang rusak.

Jangan menaruh secret Keycloak (`KC_BOOTSTRAP_ADMIN_PASSWORD`, secret scheduled
job) pada variabel resource server. Resource server tidak pernah menerima
password dan tidak menerbitkan token.

## Client

| Client ID | Tipe | Flow | Redirect URI tepat |
|---|---|---|---|
| `laundry-web` | Public | Authorization Code + PKCE S256 | `http://localhost:5173/callback` |
| `laundry-mobile` | Public | Authorization Code + PKCE S256 | `id.ac.ugm.laundry://oauth/callback` |
| `laundry-scheduled-job` | Confidential | Client Credentials | Tidak ada |

Callback merupakan keputusan development: frontend/mobile belum diimplementasikan.
Web origin hanya `http://localhost:5173`. Tidak ada wildcard. Mobile menggunakan
custom scheme sementara; application identifier dan claimed HTTPS/app link perlu
ditetapkan saat aplikasi mobile dibuat. Tidak ada klaim callback OS telah diuji.

Kedua public client tidak memiliki secret, password grant, implicit flow, atau
service account. PKCE dipaksa melalui `pkce.code.challenge.method=S256`. Scheduled
job tidak dapat menjalankan login pengguna dan tidak mendapat refresh token.
Secret job tetap hanya pada runtime server.

## Scope dan user

Nama scope mengikuti `openapi.yaml`: `orders:read`, `orders:write`,
`pickups:read`, `orders:fulfil`, `pickups:write`.
Setiap scope opsional dibatasi role mapping; `fullScopeAllowed=false`. Audience
mapper selalu memasukkan `laundry-api` pada access token, bukan ID token.

| User uji | Role | Scope yang diizinkan |
|---|---|---|
| `student-a`, `student-b` | customer | `orders:read`, `orders:write` |
| `courier-a`, `courier-b` | driver | `pickups:read`, `pickups:write` |
| `staff-outlet-a`, `staff-outlet-b` | staff | `orders:read`, `pickups:read`, `orders:fulfil` |
| service account scheduled job | mesin | `orders:read`, `pickups:read` |

Web dibatasi ke scope staf; mobile ke scope customer/driver; token hanya mendapat
scope yang diminta dan sesuai role. Nama user tetap memakai istilah tugas,
dengan student=Customer dan courier=Driver. Selain enam user manusia uji, terdapat
satu service account otomatis untuk scheduled job.

### Claim identitas untuk object authorization

Backend memetakan claim provider ke principal internal
(`service/src/auth/principal.js`). Keycloak **tidak** menerbitkan user attribute
pada token secara otomatis: setiap atribut memerlukan
`oidc-usermodel-attribute-mapper` eksplisit.

Tiga client scope wajib ada dan terpasang sebagai `defaultClientScopes` pada
kedua public client:

| Client scope | Claim yang diterbitkan | Mengapa wajib |
|---|---|---|
| `basic` | `sub` | `principal.js` melempar error tanpa `sub`, sehingga **setiap** token asli dijawab `401` |
| `roles` | `realm_access.roles` | `principal.js` membaca role untuk menentukan `kind` dan fallback outlet staf |
| `laundry-identity` | `fixture_domain_id`, `outlet_id` | `principal.domainId` dan `principal.outletId` |

**Penting:** `basic` dan `roles` adalah client scope bawaan Keycloak. Mendeklarasikan
`clientScopes` di file import realm **menggantikan** himpunan bawaan itu, bukan
menambahinya. Realm yang diimpor tanpa mendeklarasikan ulang keduanya akan
kehilangan claim `sub` dan `realm_access`, dan service akan menolak semua token
dengan `401` — gejala yang mudah salah didiagnosis sebagai masalah issuer/audience.

Ketiganya memakai `include.in.token.scope: false`, sehingga mappers tetap berjalan
tetapi nama scope-nya tidak muncul pada claim `scope`. Claim `scope` hanya boleh
berisi capability scope (`orders:read`, `pickups:write`, dst).

`fixture_domain_id` dan `outlet_id` disimpan sebagai user attribute
(`auth/keycloak/prepare.mjs`), dengan `outlet_id` hanya ada pada staf.

Tanpa ketiga scope ini, `principal.js` jatuh ke fallback `sub` atau gagal total,
sehingga aturan kepemilikan membandingkan username terhadap identifier domain dan
setiap object dijawab `404`.

`customerId` pada body atau URL tidak pernah diperlakukan sebagai bukti
kepemilikan; identitas domain hanya berasal dari claim provider.

### Memperbaiki realm yang sudah ter-import

Keycloak melewati `--import-realm` bila realm sudah ada. Realm yang dibuat sebelum
client scope di atas ditambahkan harus diperbaiki melalui admin API:

```bash
node auth/keycloak/import.mjs http://localhost:8081
node auth/keycloak/import.mjs https://keycloak-production-68f0.up.railway.app
```

Script ini idempotent: ia membuat client scope yang hilang, merekonsiliasi
protocol mapper, memasang scope pada kedua public client, dan memastikan atribut
user. Aman dijalankan berulang kali. Tidak ada secret atau token yang dicetak.

### Bukti end-to-end dengan provider asli

Test suite utama (`tests/authz/test-authz.js`) memakai signing key khusus test dan
menyuntikkan `fixture_domain_id` langsung ke payload, sehingga **tetap lulus**
meskipun provider tidak pernah menerbitkan claim tersebut. Untuk menutup celah
itu, bukti end-to-end dijalankan terhadap Keycloak yang benar-benar berjalan:

```bash
# provider + service lokal
node auth/keycloak/e2e-proof.mjs

# provider + service yang sudah di-deploy
node auth/keycloak/verify-deployment.mjs \
  https://pbse.kevinio.my.id \
  https://keycloak-production-68f0.up.railway.app
```

`verify-deployment.mjs` login melalui Authorization Code + PKCE, lalu menguji
deployment dengan token asli:

| Pemeriksaan | Hasil |
|---|---|
| Token memuat `sub`, `realm_access.roles`, `fixture_domain_id`, `outlet_id`, `aud` | Lulus |
| Tanpa token | `401` |
| **Token asli diterima** | **`200`** |
| Scope kurang (student pada operasi staf) | `403` |
| Scope ditolak sebelum object di-load (ID tidak ada pun `403`) | Lulus |
| Object milik caller lain | `404` |
| Body `404` absent vs not-owned identik | Lulus |
| `createOrder` dengan identitas domain dari claim | `201` |
| Outlet binding diambil dari token, bukan request | `outlet_a` |

Pemeriksaan "token asli diterima" adalah yang menentukan: service yang menolak
**semua** token juga menjawab `401`, sehingga "tanpa token -> 401" saja tidak
membuktikan konfigurasi benar.

## Verifikasi

`verify.mjs` menginspeksi realm/client/user menggunakan admin lokal, lalu memeriksa
JWT bertanda tangan dengan JWKS, issuer, audience, expiry, grant scheduled job,
login Authorization Code + PKCE kedua public client, pembatasan scope, dan
penolakan PKCE hilang/plain. Login admin khusus setup memakai `admin-cli` realm
master; password grant tetap mati untuk seluruh client aplikasi laundry.

Pemeriksaan ini tidak menguji middleware service, empat negative test object,
atau CI tahap 11/12. Urutan RT1 -> RT2 -> reuse RT1 -> penolakan RT2 dibuktikan
terpisah pada tahap 10; setting rotation saja bukan bukti family revocation.

Status live (17 September 2026): **LULUS pemeriksaan setup tahap 3 lokal**.

- Realm berhasil diimpor pada Keycloak 26.7.3; discovery/JWKS cocok dengan tabel.
- Tiga client dan enam user uji tersedia, termasuk role serta pembatasan scope.
- Login Authorization Code + PKCE dan penerbitan refresh token web/mobile lulus.
- PKCE hilang/plain ditolak; scope di luar role tidak diberikan.
- Client Credentials menghasilkan JWT RS256 audience `laundry-api`, hanya scope
  baca, dan tanpa refresh token.
- Rotation aktif dengan maximum reuse 0; bukti runtime pencabutan seluruh family
  lulus pada tahap 10 dan dicatat di bawah.

Command verifikasi: `node auth/keycloak/verify.mjs`. Output aman tersimpan di
[p4-keycloak-verification.txt](p4-keycloak-verification.txt).
Compose laundry milik Service Owner tidak diubah; tambahan auth dapat digabung
ketika diperlukan menggunakan `-f docker-compose.yml -f docker-compose.auth.yml`.
Jangan menjalankan gabungan tersebut sampai memang ingin menyalakan service
laundry juga. Image/data service P3 tidak disentuh oleh pemeriksaan ini.

## Bukti tahap 10 - refresh-token rotation

Jalankan setelah Keycloak aktif:

```bash
node auth/keycloak/test-refresh-rotation.mjs
```

Script melakukan login Authorization Code + PKCE pada web dan mobile, lalu
menjalankan urutan yang diwajibkan tugas. Nilai token tidak pernah dicetak:

| Client | RT1 -> RT2 berbeda | Reuse RT1 | RT2 setelah reuse |
|---|---|---|---|
| `laundry-web` | Lulus | Lulus (`invalid_grant`) | Lulus (`invalid_grant`) |
| `laundry-mobile` | Lulus | Lulus (`invalid_grant`) | Lulus (`invalid_grant`) |

Bukti terakhir dijalankan pada 17 September 2026. Hasil tersanitasi ada di
[`docs/p4-refresh-rotation-verification.txt`](p4-refresh-rotation-verification.txt).
Pengujian ini membuktikan rotation dan pencabutan family pada Keycloak lokal;
ini bukan bukti deployment production atau Auth0 hosted.

## Referensi

- [Menjalankan Keycloak dalam container](https://www.keycloak.org/server/containers)
- [Import realm](https://www.keycloak.org/server/importExport)
- [Server administration: client scope, PKCE, dan token](https://www.keycloak.org/docs/latest/server_admin/)
- [ADR 0003](decisions/0003-autentikasi.md)
