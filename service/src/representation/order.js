'use strict';

function toOrderRepresentation(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    serviceType: row.service_type,
    weightKg: row.weight_kg,
    pickupAddress: row.pickup_address,
    status: row.status,
    // Null until a staff outlet takes the order in. Additive response field:
    // clients ignore unknown fields, so this stays backward compatible.
    outletId: row.outlet_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { toOrderRepresentation };
