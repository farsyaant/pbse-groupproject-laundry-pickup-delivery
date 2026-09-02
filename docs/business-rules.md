# Business Rules

## 1. Service Authority

The service is the authoritative source for enforcing business rules.

Client-side validation may be used to improve user experience, but it must not be relied upon to enforce business constraints.

A request that bypasses client-side validation must still be validated by the service.

For the Laundry Pickup & Delivery workflow, the service is responsible for validating:

* The authenticated actor's identity and permissions.
* Whether the customer owns the order they are attempting to cancel.
* The current server-side state of the order.
* Whether the requested state transition is allowed by the order lifecycle.

---

## 2. Primary Business Rule: Order Cancellation

### Rule

A customer may cancel an order only while the order is in one of the following states:

* `pending_pickup`
* `ready_for_pickup`
* `confirmed`

Once a driver has been assigned and the order reaches `assigned`, the order can no longer be cancelled by the customer.

The cancellation operation is represented as a consequential state transition:

```text
POST /v1/orders/{orderId}/cancellation
```

The rule exists because assigning a driver creates a commitment to perform the pickup. Allowing cancellation after a driver has been assigned could result in wasted time and effort for the driver.

---

## 3. Order State Lifecycle

The order follows the following lifecycle:

```text
pending_pickup
       |
       +----------------> cancelled
       |
       v
ready_for_pickup
       |
       +----------------> cancelled
       |
       v
confirmed
       |
       +----------------> cancelled
       |
       v
assigned
       |
       v
picked_up
       |
       v
processing
       |
       v
completed
```

### Order States

| Status             | Description                                                              | Triggered By           |
| ------------------ | ------------------------------------------------------------------------ | ---------------------- |
| `pending_pickup`   | A newly created order waiting for staff review.                          | Customer creates order |
| `ready_for_pickup` | The order has been approved by staff and is ready for driver assignment. | Staff Laundry          |
| `confirmed`        | The system/staff is actively searching for an available driver.          | Staff Laundry          |
| `assigned`         | A driver has been assigned to the order.                                 | Staff Laundry / system |
| `picked_up`        | The driver has picked up the laundry from the customer.                  | Driver                 |
| `processing`       | The laundry is being processed by the laundry staff.                     | Staff Laundry          |
| `completed`        | The laundry has been processed and returned to the customer.             | Staff Laundry          |
| `cancelled`        | The order has been cancelled by the customer.                            | Customer               |

---

## 4. Allowed and Prohibited State Transitions

The service must only perform state transitions that are valid for the order lifecycle.

### Allowed Transitions

| Current Status     | Next Status        | Actor                  |
| ------------------ | ------------------ | ---------------------- |
| `pending_pickup`   | `ready_for_pickup` | Staff Laundry          |
| `pending_pickup`   | `cancelled`        | Customer               |
| `ready_for_pickup` | `confirmed`        | Staff Laundry          |
| `ready_for_pickup` | `cancelled`        | Customer               |
| `confirmed`        | `assigned`         | Staff Laundry / system |
| `confirmed`        | `cancelled`        | Customer               |
| `assigned`         | `picked_up`        | Driver                 |
| `picked_up`        | `processing`       | Staff Laundry          |
| `processing`       | `completed`        | Staff Laundry          |

### Prohibited Cancellation Transitions

The following cancellation transitions are not allowed:

```text
assigned      → cancelled
picked_up     → cancelled
processing    → cancelled
completed     → cancelled
cancelled     → cancelled
```

If a cancellation request is received for an order in one of these states, the service must reject the request with:

```text
409 Conflict
```

using the Problem Details format.

---

## 5. Actor Authorization

The system has three primary actors with different permissions:

### Customer

The customer may:

* Create an order.
* View their own orders.
* Cancel their own order while cancellation is permitted.

The customer may not:

* View another customer's order.
* Assign a driver.
* Update the order's processing status.

### Staff Laundry

Staff Laundry may:

* View all orders.
* Mark an order as ready for pickup.
* Monitor driver assignment.
* Update the order during the laundry processing workflow.

Staff Laundry may not perform customer cancellation through the customer cancellation operation.

### Driver

The driver may:

* View pickups assigned to them.
* Update the status of their assigned pickup.

The driver may not:

* View pickups assigned to other drivers.
* Change the ownership or customer information of an order.
* Cancel an order through the customer cancellation operation.

---

## 6. Business Rule Decomposition

The primary business rule is divided into three layers.

### Service — Enforces

The service is the only authoritative layer responsible for enforcing the order cancellation rule.

When receiving a cancellation request, the service must:

1. Authenticate the requesting actor.
2. Verify that the actor is the customer who owns the order.
3. Retrieve the current order state from the authoritative data source.
4. Verify that the current order status is `pending_pickup`, `ready_for_pickup`, or `confirmed`.
5. Perform the cancellation only if all required conditions are satisfied.

The service must not rely on order status supplied by the client to determine whether cancellation is allowed.

If the order is already `assigned` or has progressed beyond that state, the service must reject the cancellation request.

The rejection must use:

```text
409 Conflict
```

with the Problem Details type:

```text
https://api.example.com/problems/order-not-cancellable
```

---

### Contract — States

The API contract must communicate the business rule so that clients can predict the expected behavior.

The `Order` schema must expose the order status as an enum containing:

```text
pending_pickup
ready_for_pickup
confirmed
assigned
picked_up
processing
completed
cancelled
```

The cancellation operation must document that cancellation is only permitted while the order is in:

```text
pending_pickup
ready_for_pickup
confirmed
```

The operation must also document `409 Conflict` as a possible response when cancellation is not allowed because of the current order state.

The Problem Details response may include extension members such as:

```json
{
  "currentStatus": "assigned",
  "allowedStatuses": [
    "pending_pickup",
    "ready_for_pickup",
    "confirmed"
  ]
}
```

These values allow clients to understand the reason for the rejection without having to infer the business rule themselves.

---

### Client — Predicts

Clients may use the order status to provide appropriate user experience.

For example, the mobile customer application may display the cancellation action while the order is in a cancellable state and hide or disable it once the order reaches `assigned`.

The web admin dashboard may display the current order state and indicate whether cancellation is still possible.

The MCP client may use the documented order status and cancellation rule to determine whether it should attempt the cancellation operation.

However, these client-side behaviors are only predictions and UX optimizations.

Clients must still handle:

```text
409 Conflict
```

because the order state may change between the time the client observes the order and the time the cancellation request reaches the service.

For example:

```text
Client observes:
status = confirmed
        ↓
Client displays "Cancel Order"
        ↓
Order changes:
confirmed → assigned
        ↓
Client sends cancellation request
        ↓
Service checks current state:
assigned
        ↓
409 Conflict
```

---

## 7. Single-Layer Enforcement

The order cancellation rule is enforced authoritatively only by the service.

The client may predict whether cancellation is available based on the order status, and the API contract may describe the rule, but neither the client nor the contract is an enforcement mechanism.

A request sent directly to the API must be subject to the same validation as a request sent through the normal client application.

For example, if an order has already reached `assigned`, the following request must be rejected:

```http
POST /v1/orders/{orderId}/cancellation
```

The service must return:

```text
409 Conflict
```

regardless of whether the request originated from:

* Web client
* Mobile client
* MCP client
* Direct HTTP client

This ensures that the business rule cannot be bypassed by using a different client.

---

# 8. Error Catalog

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

For the primary business rule, attempting to cancel an order after it has reached `assigned` or a later state results in:

```text
409 Conflict
```

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

# 9. Problem Details

All API errors must use the:

```http
Content-Type: application/problem+json
```

media type.

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

For an order cancellation rejected because the order is no longer cancellable, an example response is:

```json
{
  "type": "https://api.example.com/problems/order-not-cancellable",
  "title": "Order cannot be cancelled",
  "status": 409,
  "detail": "The order cannot be cancelled because a driver has already been assigned.",
  "instance": "/v1/orders/ord_01HZX2Y5K7/cancellation",
  "currentStatus": "assigned",
  "allowedStatuses": [
    "pending_pickup",
    "ready_for_pickup",
    "confirmed"
  ]
}
```

---

# 10. Idempotency Policy

## Purpose

Idempotency prevents an unsafe operation from being executed multiple times when a client retries a request.

This is particularly important for clients operating under unreliable network conditions, especially the mobile client used by the driver and customer.

## Header

Unsafe mutation operations must use:

```http
Idempotency-Key: <UUID>
```

The key must use UUID v4 format.

## Key Creation

The client must generate the idempotency key when the user confirms the consequential operation.

The same key must be persisted together with the pending request.

A new key must not be generated merely because the client is retrying the same operation.

## Retention

The service retains idempotency records for:

```text
24 hours
```

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

The service must distinguish between:

* A request rejected before the operation was performed.
* A request that successfully performed the operation.
* A request whose final result is temporarily unknown.

The final behavior for failed requests associated with an idempotency key must be implemented consistently with the API contract.

---

# 11. Retry Policy

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

# 12. Business Rule Summary

The primary business rule for the Laundry Pickup & Delivery workflow is:

> **A customer may cancel their own order only while the order is in `pending_pickup`, `ready_for_pickup`, or `confirmed`. Once a driver has been assigned and the order reaches `assigned`, cancellation is no longer permitted.**

The responsibility is divided as follows:

```text
Service
→ Authoritatively enforces the rule.

Contract
→ Documents the allowed states and possible rejection.

Client
→ Predicts the outcome and provides appropriate UX,
  but does not enforce the rule.
```

The service therefore remains the single authoritative source for determining whether an order cancellation is valid.
