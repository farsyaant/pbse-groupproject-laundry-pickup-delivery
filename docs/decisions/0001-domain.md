# 0001 — Domain Selection

## Context

The Laundry Pickup & Delivery system provides a workflow for customers to submit laundry orders and receive pickup and delivery services. The system involves multiple actors with different responsibilities and requires reliable handling of consequential operations.

The selected workflow must be sufficiently small to be completed as one coherent flow while still demonstrating important platform-based API concerns, including authorization, unreliable connectivity, error handling, and idempotent mutations.

The system is expected to support at least three actors with different access rights, an unsafe operation whose duplicate execution could cause unwanted consequences, and at least one client operating under unreliable network conditions.

## Decision

The team selected a workflow spanning the full order lifecycle — from order creation through pickup, processing, and completion — rather than the narrower Pickup Workflow (Alternative 2) originally favored for scope control. This decision was made because the team determined that demonstrating the complete state machine, including the assignment and cancellation boundary, provided clearer material for interface design without materially increasing implementation complexity within this assignment's timeframe.

The workflow's states are: `pending_pickup`, `ready_for_pickup`, `confirmed`, `assigned`, `picked_up`, `processing`, `completed`, and `cancelled`. Full detail is documented in `docs/domain.md`.

## Alternatives Considered

### Alternative 1 — Full Laundry Lifecycle

The system could model the complete lifecycle from order creation through pickup, washing, delivery, and completion.

Initially deprioritized due to concerns about state and interaction complexity for a small contract-first assignment. However, this concern was revisited and ultimately outweighed by the benefits of demonstrating the complete state machine — see Decision above.

### Alternative 2 — Laundry Pickup Workflow

The system could focus specifically on the process of creating an order and requesting a laundry pickup.

This provides a clear consequential operation and can demonstrate idempotency and business-rule validation without requiring the entire laundry lifecycle.

### Alternative 3 — Order Cancellation Workflow

The system could focus on cancellation of a laundry order.

This provides a clear business rule, such as restricting cancellation after processing has started, and naturally demonstrates domain rejection through `409 Conflict`.

However, cancellation alone may provide a narrower workflow than the pickup process.

## Consequences

The selected workflow should remain small enough to be represented clearly in the OpenAPI contract.

Business rules must be documented before being translated into API behavior.

Unsafe operations must define their idempotency behavior explicitly.

Business-rule violations must be represented using appropriate Problem Details responses rather than relying solely on client-side validation.

Detailed resource modeling decisions are documented in `docs/resource-modeling.md`, and the API compatibility policy is documented in `docs/compatibility.md`.

## Status

Final — workflow and domain scope confirmed by the Client Owner and the team. Full detail in `docs/domain.md`, `docs/client-taxonomy.md`, and `docs/business-rules.md`.
