# Business Rules

## 1. Service Authority

The service is the authoritative source for enforcing business rules.

Client-side validation may be used to improve user experience, but it must not be relied upon to enforce business constraints.

A request that bypasses client-side validation must still be validated by the service.

---

## 2. Primary Business Rule

### Rule

An order may only undergo a consequential state transition when its current state allows that transition.

For example, an order that has already entered a non-cancellable processing state must not be cancelled.

### Service

The service must validate the current state of the resource before performing the state transition.

If the transition is not allowed, the service must reject the request.

### Contract

The API contract must document:

* the valid operation,
* the required request data,
* successful response,
* possible domain rejection,
* and the corresponding HTTP status code.

A state transition that is not allowed because of the current domain state should return `409 Conflict`.

### Client

The client may inspect the resource state and disable or hide actions that are known to be unavailable.

However, the client must still handle a `409 Conflict` response because the resource state may change between the time it is displayed and the time the request is submitted.

---

# Error Catalog

## Client Fault

Client faults represent requests that cannot be processed because the request or authentication information is invalid.

| Condition                         | Status | Retry |
| --------------------------------- | -----: | ----- |
| Malformed or invalid request      |    400 | No    |
| Missing or invalid authentication |    401 | No    |
| Insufficient permission           |    403 | No    |
| Resource does not exist           |    404 | No    |
| Invalid request data              |    422 | No    |

## Domain Rejection

Domain rejection means that the request is structurally valid but cannot be performed because of the current business state.

| Condition                                     | Status | Retry |
| --------------------------------------------- | -----: | ----- |
| Invalid state transition                      |    409 | No    |
| Idempotency key reused with different request |    409 | No    |
| Domain validation failure                     |    422 | No    |

## Server Fault

Server faults represent temporary or unexpected failures on the service side.

| Condition                       | Status | Retry |
| ------------------------------- | -----: | ----- |
| Unexpected internal error       |    500 | Yes   |
| Upstream dependency failure     |    502 | Yes   |
| Service temporarily unavailable |    503 | Yes   |
| Gateway/upstream timeout        |    504 | Yes   |

Retries for server faults should use exponential backoff and should not be performed indefinitely.

---

# Problem Details

All API errors must use the `application/problem+json` media type.

The minimum response structure is:

```json
{
  "type": "https://api.example.com/problems/example",
  "title": "Example problem",
  "status": 409,
  "detail": "The requested operation cannot be performed.",
  "instance": "/v1/resources/example"
}
```

The service may provide additional extension members when they are useful to the client.

---

# Idempotency Policy

## Purpose

Idempotency prevents an unsafe operation from being executed multiple times when a client retries a request.

This is particularly important for clients operating under unreliable network conditions, where a request may have succeeded even though the client did not receive the response.

## Header

Unsafe mutation operations must use:

```http
Idempotency-Key: <UUID>
```

The key should use UUID v4 format.

## Key Creation

The client must generate the idempotency key when the user confirms the consequential operation.

The same key must be persisted together with the pending request.

A new key must not be generated merely because the client is retrying the same operation.

## Retention

The service retains idempotency records for **24 hours**.

This retention period may be adjusted by the team if the final domain workflow requires a different operational policy.

## Same Key, Same Request

If the same idempotency key is received with the same request parameters, the service must not execute the operation a second time.

The service should return the result associated with the original request.

## Same Key, Different Request

If an idempotency key is reused with a different request body or materially different request parameters, the service must reject the request with:

```text
409 Conflict
```

The service must not execute the new operation.

## Request Still Processing

If the same idempotency key is received while the original request is still being processed, the service must not execute the operation concurrently a second time.

The service should return an appropriate conflict response, such as:

```text
409 Conflict
```

indicating that the request associated with the idempotency key is still being processed.

## Failed Requests

The final behavior for failed requests associated with an idempotency key must be defined consistently in the API contract.

The team must distinguish between:

* a request that was rejected before the operation was performed,
* a request that successfully performed the operation,
* and a request whose final result is temporarily unknown.

---

# Retry Policy

Clients must not automatically retry:

* `400`
* `401`
* `403`
* `404`
* `409`
* `422`

Clients may retry transient server failures such as:

* `500`
* `502`
* `503`
* `504`

Retries should use exponential backoff.

Unsafe operations must always preserve the original `Idempotency-Key` during retries.

---

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
