# Client Taxonomy — Five Axes

Setiap client dinilai terhadap lima sumbu yang menentukan apa yang wajib disediakan interface. Nilai ditentukan oleh constraint klien, bukan aktor atau nama platformnya. Namun, tiap baris menjelaskan aktor mana yang memakainya.

| Client | Digunakan Oleh | Secret? | Network | Latency Budget | Hardware | Human Present? |
|---|---|---|---|---|---|---|
| Web | Staff Laundry (dashboard admin) | Tidak | Reliable | ~2s | Unlimited | Ya, sibuk |
| Mobile | Customer (buat & pantau order) & Driver (terima & update pickup) | Sebagian | Intermiten | ~1s (customer) / menit (driver) | Baterai, data terbatas | Ya |
| Device (scanner loket) | Tidak ada aktor manusia — dioperasikan staf di loket | Provisioned | Unattended | Menit | Terbatas | Tidak |
| MCP (assistant agent) | Customer (order lewat perintah natural) | Ya | Reliable | ~2s | Unlimited | Tidak — dan dia bertindak |

## Kesimpulan per Client

**Web**
Digunakan staf laundry dari lokasi tetap (loket/kantor) untuk meninjau order, mencari driver, dan memantau proses hingga selesai. Karena browser tidak dapat menyimpan rahasia dengan aman, klien ini memerlukan public-client authentication flow. Karena jaringannya reliable, klien ini tidak memerlukan durable queue atau offline handling. Karena staf sering menangani banyak order bersamaan dan sibuk, response time harus cukup cepat (~2 detik) agar tidak menghambat alur kerja operasional.

**Mobile**
Digunakan dua aktor berbeda pada platform yang sama: customer (membuat & memantau order, membatalkan bila masih diizinkan) dan driver (menerima penugasan, memperbarui status pickup). Karena driver dapat mengalami jaringan intermiten saat menuju lokasi pickup, klien ini memerlukan durable mutation queue untuk menyimpan pembaruan status secara lokal sampai koneksi kembali tersedia. Operasi pembuatan order (customer) dan pembaruan status pickup (driver) sama-sama memerlukan idempotency key agar retry akibat koneksi terputus tidak menghasilkan duplikasi.

**Device (scanner loket)**
Berupa scanner barcode/QR di loket laundry untuk mencatat cucian yang
keluar-masuk pada tahap `processing`. Karena perangkat ini beroperasi
tanpa pengawasan langsung dan memiliki sumber daya terbatas, klien ini hanya mengirim payload minimal dan menggunakan kredensial yang
di-provision sekali di awal, bukan token login manual yang memerlukan
interaksi manusia.

**MCP (assistant agent)**
Agent AI yang memungkinkan customer membuat atau memantau order lewat
perintah bahasa natural (mis. "cek status cucianku"). Karena tidak ada manusia yang menafsirkan response di sisi agent, melainkan penafsiran secara mandiri dan langsung bertindak, desain error pada operasi order harus jelas dan dapat ditindaklanjuti tanpa ambiguitas, dan idempotency key menjadi krusial karena agent berpotensi retry otomatis tanpa konfirmasi manusia terlebih dahulu.