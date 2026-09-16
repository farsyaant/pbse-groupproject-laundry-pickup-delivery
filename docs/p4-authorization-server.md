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

Nama scope mengikuti `openapi.yaml` versi 1.0.0, commit `e9eaf91`:
`orders:read`, `orders:write`, `pickups:read`, `orders:fulfil`, `pickups:write`.
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

Atribut `fixture_domain_id` hanya penanda fixture, bukan object authorization yang
sudah aktif. Backend belum menghubungkan `sub` dengan customer/driver/outlet.
Fixture database dan endpoint mutation pickup/staf tetap pekerjaan tahap terkait.

## Verifikasi

`verify.mjs` menginspeksi realm/client/user menggunakan admin lokal, lalu memeriksa
JWT bertanda tangan dengan JWKS, issuer, audience, expiry, grant scheduled job,
login Authorization Code + PKCE kedua public client, pembatasan scope, dan
penolakan PKCE hilang/plain. Login admin khusus setup memakai `admin-cli` realm
master; password grant tetap mati untuk seluruh client aplikasi laundry.

Pemeriksaan ini tidak menguji middleware service, empat negative test object,
atau CI tahap 11/12. Urutan RT1 -> RT2 -> reuse RT1 -> penolakan RT2 tetap perlu
bukti pada tahap 10; setting rotation saja bukan bukti family revocation.

Status live (16 September 2026): **LULUS pemeriksaan setup tahap 3 lokal**.

- Realm berhasil diimpor pada Keycloak 26.7.3; discovery/JWKS cocok dengan tabel.
- Tiga client dan enam user uji tersedia, termasuk role serta pembatasan scope.
- Login Authorization Code + PKCE dan penerbitan refresh token web/mobile lulus.
- PKCE hilang/plain ditolak; scope di luar role tidak diberikan.
- Client Credentials menghasilkan JWT RS256 audience `laundry-api`, hanya scope
  baca, dan tanpa refresh token.
- Rotation aktif dengan maximum reuse 0; bukti runtime pencabutan seluruh family
  belum dijalankan dan tetap menjadi checkpoint tahap 10.

Command verifikasi: `node auth/keycloak/verify.mjs`. Output aman tersimpan di
[p4-keycloak-verification.txt](p4-keycloak-verification.txt).
Compose laundry milik Service Owner tidak diubah; tambahan auth dapat digabung
ketika diperlukan menggunakan `-f docker-compose.yml -f docker-compose.auth.yml`.
Jangan menjalankan gabungan tersebut sampai memang ingin menyalakan service
laundry juga. Image/data service P3 tidak disentuh oleh pemeriksaan ini.

## Referensi

- [Menjalankan Keycloak dalam container](https://www.keycloak.org/server/containers)
- [Import realm](https://www.keycloak.org/server/importExport)
- [Server administration: client scope, PKCE, dan token](https://www.keycloak.org/docs/latest/server_admin/)
- [ADR 0003](decisions/0003-autentikasi.md)
