'use strict';

const db = require('../database');

const insertStmt = db.prepare(`
  INSERT INTO cancellations (id, order_id, reason, status, created_at)
  VALUES (@id, @order_id, @reason, @status, @created_at)
`);

const findByOrderIdStmt = db.prepare(
  'SELECT * FROM cancellations WHERE order_id = ?',
);

function insert(cancellation) {
  insertStmt.run(cancellation);
}

function findByOrderId(orderId) {
  return findByOrderIdStmt.get(orderId) || null;
}

module.exports = { insert, findByOrderId };
