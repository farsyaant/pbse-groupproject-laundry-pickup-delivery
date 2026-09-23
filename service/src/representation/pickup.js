'use strict';

function toPickupRepresentation(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    driverId: row.driver_id,
    scheduledAt: row.scheduled_at,
    address: row.address,
    status: row.status,
  };
}

module.exports = { toPickupRepresentation };
