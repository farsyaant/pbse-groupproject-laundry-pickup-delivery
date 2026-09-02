<div align="center">

# 🧺 Laundry Pickup & Delivery
**Platform Pemesanan dan Penjemputan Laundry**

<p align="center">
  <a href="#-gambaran-umum">Gambaran Umum</a> •
  <a href="#-pembagian-peran">Kelompok</a> •
  <a href="#-domain--alur-kerja">Domain</a> •
  <a href="#-struktur-repositori">Struktur</a> •
  <a href="#-menjalankan-mock-server">Mock Server</a> •
</p>

</div>

---

## 🏛️ Identitas Proyek

**Proyek Mata Kuliah PACS262520 - Platform Based Software Engineering Kelas KOM**
Program Studi Ilmu Komputer, Departemen Ilmu Komputer dan Elektronika, FMIPA UGM - Semester Gasal 2026/2027

### 👥 Kelompok

| Nama Anggota | NIM|
| :--- | :--- |
| Ayasha Rahmadinni (Aya)| 24/545462/PA/23178 |
| Farsya Nabila Tori (Tori)| 24/543855/PA/23113 |
| Kevin Antonio Wiyono Lauw (Kevin) | 24/535917/PA/22736 |
| Maulana Faris Al Ghifari (Faris)| 24/544029/PA/23119 |

---

## 📋 Gambaran Umum

Sistem ini memodelkan alur pemesanan laundry dengan penjemputan oleh
driver, dibangun sebagai proyek **contract-first**: seluruh antarmuka
(`openapi.yaml`) dirancang dan divalidasi terlebih dahulu sebelum satu
baris kode backend ditulis. Proyek ini membangun **satu service**, lalu
menempelkan client baru (web, mobile, device, MCP) tanpa pernah menulis
ulang service-nya.

---

## 🧩 Pembagian Peran

Peran berotasi setiap 3 pertemuan; seorang anggota tidak boleh memegang
peran yang sama dua periode berturut-turut.

| Peran | Tanggung Jawab | 
| :--- | :--- | 
| **Contract Owner** | Pemegang tanggung jawab atas `openapi.yaml`; setiap perubahan antarmuka ditinjau oleh peran ini |
| **Service Owner** | Backend yang di-deploy, konfigurasi, migrasi, health endpoint (mulai Pertemuan 3) | 
| **Client Owner** | Klien yang dihadapi pengguna; pelaporan tertulis atas ambiguitas dalam kontrak |
| **Integration Owner** | Mock server, contract test, koordinasi dengan kelompok mitra (Pertemuan 7) |

Pembagian peran pada 3 pertemuan pertama:
| Nama | Peran |
| :--- | :--- |
| Aya | Service Owner |
| Tori | Client Owner |
| Kevin | Contract Owner |
| Faris | Integration Owner |

---

## 🗺️ Domain & Alur Kerja

Customer mengajukan order laundry dengan menentukan jenis layanan, berat
cucian, dan alamat pickup. Staf laundry meninjau order yang masuk dan
menandainya siap dijemput, lalu sistem mencari driver yang tersedia
hingga driver ditugaskan. Driver mengambil cucian dari alamat customer yang
sering kali bekerja di lokasi dengan sinyal tidak stabil, dan order
kemudian diproses hingga selesai dan diantarkan kembali ke customer.
Customer dapat membatalkan order selama belum ada driver yang ditugaskan.

### State Machine Order

```
pending_pickup -> ready_for_pickup -> confirmed -> assigned -> picked_up -> processing -> completed
      |                  |              |
      v                  v              v
  cancelled          cancelled      cancelled
```

### Tiga Aktor Utama

| Aktor | Hak Akses Utama |
| :--- | :--- |
| **Customer** | Buat order, lihat order sendiri, batalkan sebelum `assigned` |
| **Staff Laundry** | Lihat semua order, tandai siap dijemput, kelola pencarian driver |
| **Driver** | Lihat & update status pickup miliknya sendiri |

📄 Dokumentasi lengkap:
[`docs/domain.md`](docs/domain.md) ·
[`docs/client-taxonomy.md`](docs/client-taxonomy.md) ·
[`docs/business-rules.md`](docs/business-rules.md)

---

## 📂 Struktur Repositori

```text
laundry-pickup-delivery/
├── openapi.yaml              # 📄 Kontrak API 
├── CHANGELOG.md               # Catatan perubahan kontrak
├── docs/
│   ├── domain.md               # Deskripsi domain & pemeriksaan 4 syarat
│   ├── client-taxonomy.md      # Taksonomi client (5 sumbu)
│   ├── business-rules.md       # Dekomposisi aturan bisnis
│   └── decisions/
│       └── 0001-domain.md      # ADR pemilihan domain
├── service/                   # Backend (P3)
├── clients/
│   ├── web/                    # Dashboard admin (P5)
│   ├── mobile/                 # App customer & driver (P6)
│   ├── device/                 # Scanner loket (P11)
│   └── mcp/                    # Assistant agent (P12)
└── tests/
    └── contract/                # Pengujian kesesuaian service vs openapi.yaml
```

---

## 🖥️ Menjalankan Mock Server

> ⚠️ **TODO (Integration Owner):** lengkapi setelah `openapi.yaml` final.

```bash
pnpm dlx @stoplight/prism-cli mock openapi.yaml -p 4010
```

### Contoh Perintah `curl`

```bash
# 1. GET collection
curl -i http://127.0.0.1:4010/v1/orders

# 2. GET dengan filter
curl -i "http://127.0.0.1:4010/v1/orders?status=pending_pickup"

# 3. POST dengan Idempotency-Key
curl -i -X POST http://127.0.0.1:4010/v1/orders \
  -H 'Idempotency-Key: <uuid-v4>' \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```

### Validasi Kontrak

```bash
npx @redocly/cli lint openapi.yaml
```

---

## 🔗 Referensi Materi

Proyek ini mengikuti silabus mata kuliah Platform Based Software Engineering.

---

<div align="center">

Dibuat dengan 🩷

</div>