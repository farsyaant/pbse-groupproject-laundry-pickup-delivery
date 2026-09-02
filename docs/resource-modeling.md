# Resource Modeling

Resource candidates are derived from the domain paragraph, not from screens or
implementation tables. An accepted resource has an identity, remains present
across requests, and can change through its own lifecycle.

| Candidate | Decision | Reason |
|---|---|---|
| `Order` | Accepted | Has server-generated identifier, progresses from `pending_pickup` to a terminal state, and can be created or cancelled independently. |
| `Pickup` | Accepted | Has its own identifier, lifecycle from scheduling to delivery, and status changes controlled by the pickup workflow. |
| `Cancellation` | Accepted | Has an identifier, records the lifecycle/result of a cancellation request, and remains available after the request completes. |
| `Dashboard` | Rejected | Represents a UI composition, not a domain entity with an independent identity and lifecycle. |
| `Order creation` | Rejected | Describes an operation, not a resource that persists and changes independently. |
| `Laundry process` | Rejected | Describes an activity and state transition, while the persistent resource is the `Order`. |
