# Domain Description — Laundry Pickup & Delivery

## Domain Paragraph

Customer mengajukan order laundry dengan menentukan jenis layanan, berat cucian, dan alamat pickup. Staf laundry meninjau order yang masuk dan menandainya siap dijemput, lalu sistem mencari driver yang tersedia hingga konfirmasi ketersediaan didapat dan driver ditugaskan. Driver mengambil order dari alamat customer (sering kali bekerja di lokasi dengan sinyal tidak stabil) dan order kemudian diproses hingga selesai dan diantarkan kembali ke customer. Customer dapat membatalkan order selama belum ada driver yang ditugaskan.

## Pemeriksaan Empat Syarat

**1. Minimal tiga jenis aktor dengan hak akses berbeda — TERPENUHI**
- **Customer**: membuat order, melihat order miliknya sendiri,      membatalkan order miliknya selama belum ada driver ditugaskan.
- **Staf Laundry (Admin)**: melihat seluruh order, menandai order siap dijemput, memantau pencarian & penugasan driver, memperbarui status order selama pemrosesan.
- **Driver**: melihat pickup yang ditugaskan kepadanya, memperbarui status pickup miliknya; tidak dapat melihat atau mengubah order milik customer lain.

**2. Minimal satu operasi unsafe dan konsekuensial — TERPENUHI**
- Pembuatan order (`POST /v1/orders`) tidak boleh terjadi dua kali akibat retry jaringan. Duplikasi berarti dua order fisik tercipta dari satu permintaan customer.
- Pembatalan order (`POST /v1/orders/{orderId}/cancellation`) bersifat ireversibel dan hanya diizinkan pada status tertentu.

**3. Minimal satu aktor di luar jangkauan konektivitas andal — TERPENUHI**
- Driver bekerja di lapangan (jalan raya, area customer) saat menuju lokasi pickup, di mana sinyal seluler sering terputus atau intermiten.

**4. Cakupan cukup kecil untuk diselesaikan — TERPENUHI**
- Sistem mencakup satu alur kerja utuh dari pembuatan order hingga penyelesaian dan pengantaran kembali ke customer. Fitur di luar alur ini (pembayaran, rating, riwayat multi-order) sengaja tidak dicakup.

## Aktor dan Hak Akses

| Aktor | Dapat Melakukan | Tidak Dapat Melakukan |
|---|---|---|
| Customer | Buat order, lihat order sendiri, batalkan order sendiri (sebelum `assigned`) | Melihat order customer lain, menugaskan driver |
| Staff Laundry | Lihat semua order, tandai siap dijemput, pantau pencarian driver, update status pemrosesan | Membuat order atas nama customer |
| Driver | Lihat pickup yang ditugaskan, update status pickup miliknya | Melihat pickup driver lain, mengubah data order |

## State Machine Order
```
pending_pickup -> ready_for_pickup -> confirmed -> assigned -> picked_up -> processing -> completed
      |                  |              |
      v                  v              v
  cancelled          cancelled      cancelled
```

**Definisi tiap status:**

| # | Status | Deskripsi | Dipicu Oleh |
|---|---|---|---|
| 1 | `pending_pickup` | Order baru dibuat, menunggu review admin | Customer membuat order |
| 2 | `ready_for_pickup` | Admin sudah approve order, siap dicarikan driver | Staff laundry menandai order |
| 3 | `confirmed` | Sistem/admin sedang aktif mencari driver yang tersedia | Staff laundry memulai pencarian |
| 4 | `assigned` | Driver sudah ditugaskan (resource `Pickup` dengan `driverId` terisi) | Staff laundry/sistem menugaskan driver |
| 5 | `picked_up` | Driver sudah mengambil cucian dari lokasi customer | Driver menandai pickup selesai |
| 6 | `processing` | Cucian sedang diproses di laundry | Staff laundry memulai pemrosesan |
| 7 | `completed` | Cucian selesai diproses dan diantarkan kembali ke customer | Staff laundry menandai selesai |
| 8 | `cancelled` | Order dibatalkan | Customer membatalkan (hanya dari status 1–3) |

**Aturan cancellation**: cancellation hanya diizinkan selama status masih
`pending_pickup`, `ready_for_pickup`, atau `confirmed`. Begitu order
memasuki status `assigned` (driver sudah berkomitmen) atau setelahnya,
permintaan cancellation ditolak dengan `409 Conflict`. Detail lengkap ada
di `docs/business-rules.md`.
