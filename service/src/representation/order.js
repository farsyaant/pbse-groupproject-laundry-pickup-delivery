'use strict';

function toOrderRepresentation(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    serviceType: row.service_type,
    weightKg: row.weight_kg,
    pickupAddress: row.pickup_address,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { toOrderRepresentation };
