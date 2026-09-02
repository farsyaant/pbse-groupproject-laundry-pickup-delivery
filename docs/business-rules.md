# Business Rule Decomposition — Order Cancellation

## Aturan Bisnis Terpilih

**"Customer tidak dapat membatalkan order setelah driver ditugaskan
(status `assigned`) atau setelahnya."**

Dipilih sebagai aturan bisnis utama karena pelanggarannya menimbulkan
dampak nyata terbesar: driver yang sudah berkomitmen ke sebuah pickup
akan dirugikan waktu dan usaha jika order tetap bisa dibatalkan sepihak oleh customer tanpa batasan.

## Dekomposisi Tiga Lapisan

### Service — Menegakkan (satu-satunya lapisan otoritatif)

Service menolak setiap permintaan `POST /v1/orders/{orderId}/cancellation` apabila `order.status` bukan salah satu dari `pending_pickup`, `ready_for_pickup`, atau `confirmed`.

- Pengecekan dilakukan di sisi service terhadap state yang tersimpan,
  bukan mengandalkan state yang dikirim client.
- Response: `409 Conflict` dengan Problem Details ber-`type`
  `.../problems/order-not-cancellable`.
- Ini satu-satunya tempat aturan ini berlaku secara otoritatif.

### Contract — Menyatakan

`openapi.yaml` menyatakan aturan ini lewat:

- **Enum status** pada schema `Order`: `pending_pickup, ready_for_pickup,
  confirmed, assigned, picked_up, processing, completed, cancelled`.
- **Problem type** `order-not-cancellable` di katalog error, dengan
  extension members `currentStatus` dan `allowedStatuses` supaya client bisa tahu kondisi penolakan tanpa menebak.
- **Deskripsi eksplisit** pada operasi `cancelOrder`:
  > "Cancellation is only permitted while order status is
  > `pending_pickup`, `ready_for_pickup`, or `confirmed`. Once a driver
  > has been assigned, cancellation requests are rejected with 409."

Contoh response:
```json
{
  "type": "https://api.example.com/problems/order-not-cancellable",
  "title": "Order cannot be cancelled",
  "status": 409,
  "detail": "Order has already been assigned to a driver.",
  "instance": "/v1/orders/ord_01HZX2Y5K7/cancellation",
  "currentStatus": "assigned",
  "allowedStatuses": ["pending_pickup", "ready_for_pickup", "confirmed"]
}
```

### Client — Memprediksi (bukan mengendalikan)

Semua client memprediksi hasil aturan ini berdasarkan `status` order yang mereka miliki:

- **Mobile customer app**: menyembunyikan/menonaktifkan tombol "Batalkan Order" begitu `order.status` sudah `assigned` atau setelahnya. Ini kemudahan UX, bukan kontrol.
- **Web admin dashboard**: menampilkan indikator "tidak dapat dibatalkan" pada order yang sudah `assigned`, dibaca dari field status yang sama.
- **MCP agent**: membaca aturan dari deskripsi operasi di kontrak dan
  tidak mencoba memanggil cancellation di luar status yang diizinkan.
  Kalau tetap dicoba, agent menerima `409` yang harus diformulasikan
  cukup jelas agar tidak retry berulang.

## Catatan Penegakan Tunggal

Aturan ini **hanya** ditegakkan di service. Validasi di sisi client, seperti menyembunyikan tombol sama sekali bukan mekanisme keamanan atau kontrol bisnis. Permintaan cancellation lewat `curl` langsung ke service pada order yang sudah `assigned` tetap harus menerima `409`, terlepas dari apa yang ditampilkan di UI manapun.