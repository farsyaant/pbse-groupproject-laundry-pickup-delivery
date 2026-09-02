# Panduan Kompatibilitas API (API Compatibility Policy)

Dokumen ini menetapkan aturan evolusi kontrak API untuk sistem Laundry Pickup & Delivery. Kebijakan ini memastikan bahwa perubahan pada API tidak merusak integrasi client yang sudah ada.

---

## 1. Definisi Kompatibilitas

Kompatibilitas API adalah jaminan bahwa perubahan pada kontrak API di server memungkinkan client lama (versi sebelumnya) tetap beroperasi dengan normal tanpa memerlukan modifikasi kode atau deployment ulang.

Prinsip utama evolusi API:
- Non-breaking evolution: Server berevolusi tanpa memaksa client memperbarui kode secara mendadak.
- Backward compatibility: Versi API baru tetap mendukung ekspektasi dan perilaku client lama.

---

## 2. Perubahan Kompatibel (Compatible Changes)

Perubahan kompatibel adalah perubahan pada spesifikasi API yang tidak mengganggu fungsi client yang sudah berjalan.

| Perubahan | Status | Penjelasan |
|---|---|---|
| Tambah request field opsional | Compatible | Client lama tidak mengirim field baru tersebut, server menggunakan nilai default. |
| Tambah response field | Compatible | Server mengirim field baru, client lama mengabaikan field tersebut (sesuai aturan toleransi). |
| Tambah endpoint | Compatible | Client lama tidak memanggil endpoint baru, aplikasi tetap berjalan normal. |
| Tambah query parameter opsional | Compatible | Client lama tidak menggunakan parameter baru, server memakai nilai default. |
| Tambah enum value | Compatible bersyarat | Server dapat mengembalikan nilai enum baru, client harus menangani fallback aman tanpa crash. |

---

## 3. Perubahan Merusak (Breaking Changes)

Perubahan merusak (breaking changes) adalah perubahan yang mengubah ekspektasi atau struktur API sehingga client lama gagal memproses request atau response.

| Perubahan | Status | Penjelasan |
|---|---|---|
| Optional request menjadi required | Breaking | Client lama tidak mengirim field tersebut, request ditolak server dengan error validation. |
| Menghapus response field | Breaking | Client lama mengalami null pointer error atau parsing failure karena field hilang. |
| Rename response field | Breaking | Dianggap sebagai penghapusan field lama dan penambahan field baru secara bersamaan. |
| Mengubah tipe field | Breaking | Client lama gagal melakukan deserialisasi JSON karena tipe data berubah (misal string ke number). |
| Mempersempit range value | Breaking | Nilai yang sebelumnya valid kini ditolak oleh aturan validasi server. |
| Mengubah arti field | Breaking | Nama dan tipe field sama, tetapi makna logika bisnis berubah sehingga mengacaukan pemrosesan client. |

---

## 4. Aturan Unknown Response Fields

Client harus menerapkan pola Tolerant Reader. Ketika server mengembalikan response JSON yang berisi field tambahan (unknown response fields) yang belum dikenali oleh client:

- Client harus mengabaikan field yang tidak dikenalnya tersebut.
- Client tidak boleh gagal, melempar exception, atau mengalami error deserialisasi.
- Implementasi library JSON parser di client wajib mengaktifkan opsi pemrosesan yang mengabaikan unknown properties (seperti `FAIL_ON_UNKNOWN_PROPERTIES = false` pada Jackson atau penanganan sejenis pada parser JavaScript/Dart/Swift).

---

## 5. Aturan Unknown Enum Values

Evolusi nilai enum pada server sering terjadi saat fitur bisnis berkembang. Untuk menangani hal ini:

- Client harus memiliki perilaku aman (safe fallback) saat menerima enum value baru yang belum terdaftar pada versi client tersebut.
- Client tidak boleh mengalami crash atau panic.
- Client wajib memetakan enum value yang tidak dikenal ke nilai fallback default (misal: `UNKNOWN` atau `OTHER`), atau mengabaikan aksi spesifik enum tersebut sambil menampilkan UI generik yang aman.

---

## 6. Strategi Deprecation

Jika suatu endpoint, parameter, atau field akan dihapus dari API, proses tersebut harus melalui tahapan deprecation formal sebelum benar-benar dihentikan.

### 6.1 Catatan Deprecation dalam OpenAPI Spec

Properti `deprecated: true` harus ditambahkan pada elemen spesifikasi OpenAPI (`openapi.yaml`) untuk memberi tahu pengembang bahwa fitur tersebut akan segera tidak didukung.

Contoh pada OpenAPI spec:

```yaml
paths:
  /v1/orders/{id}/legacy-status:
    get:
      summary: Get order status (legacy)
      deprecated: true
      description: Endpoint ini telah digantikan oleh GET /v1/orders/{id}.
      responses:
        '200':
          description: OK
```

### 6.2 Penggunaan HTTP Header Deprecation dan Sunset

Server yang melayani request ke fitur yang didepresiasi wajib mengirimkan HTTP Response Header standar berikut:

1. **`Deprecation` Header (RFC 8594)**
   Menandakan bahwa endpoint atau resource telah didepresiasi.
   Nilai header dapat berupa boolean `@true` atau timestamp tanggal deprecation dimulai (format HTTP date).

   Contoh:
   ```http
   Deprecation: @1704067200
   ```

2. **`Sunset` Header (RFC 8594)**
   Menandakan tanggal dan waktu pasti kapan endpoint atau resource akan dihapus secara permanen dan tidak dapat diakses lagi.

   Contoh:
   ```http
   Sunset: Wed, 30 Jun 2027 23:59:59 GMT
   ```

### 6.3 Siklus Hidup Deprecation

1. **Pengumuman**: Dokumentasikan deprecation pada `openapi.yaml` dan rilis catatan pada `CHANGELOG.md`.
2. **Masa Transisi**: Server mengembalikan header `Deprecation` dan `Sunset` pada setiap response terkait. Masa transisi minimal adalah 6 bulan.
3. **Penghentian (Sunset)**: Setelah tanggal pada header `Sunset` terlewati, endpoint dapat dinonaktifkan atau mengembalikan response `410 Gone` atau `404 Not Found`.
