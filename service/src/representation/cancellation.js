'use strict';

function toCancellationRepresentation(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  };
}

module.exports = { toCancellationRepresentation };
