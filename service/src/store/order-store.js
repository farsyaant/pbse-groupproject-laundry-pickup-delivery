'use strict';

const db = require('../database');

const findByIdStmt = db.prepare('SELECT * FROM orders WHERE id = ?');

const insertStmt = db.prepare(`
  INSERT INTO orders (id, customer_id, service_type, weight_kg, pickup_address, status, outlet_id, created_at, updated_at)
  VALUES (@id, @customer_id, @service_type, @weight_kg, @pickup_address, @status, @outlet_id, @created_at, @updated_at)
`);

const updateStatusStmt = db.prepare(
  'UPDATE orders SET status = @status, updated_at = @updated_at WHERE id = @id',
);

const assignOutletStmt = db.prepare(
  'UPDATE orders SET outlet_id = @outlet_id, updated_at = @updated_at WHERE id = @id AND outlet_id IS NULL',
);

function getById(id) {
  return findByIdStmt.get(id) || null;
}

function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * List orders visible to a principal. The visibility filter is applied inside
 * the SQL query, never after loading rows, so pagination stays correct and no
 * other caller's row is ever held in process memory.
 */
function listForPrincipal(principal, { status, limit = 20, cursor } = {}) {
  const conditions = [];
  const params = [];

  // Layer 3 applied at the query boundary: a principal bound to an outlet sees
  // that outlet's orders, everyone else only their own domain identity.
  if (principal?.outletId) {
    conditions.push('outlet_id = ?');
    params.push(principal.outletId);
  } else {
    conditions.push('customer_id = ?');
    params.push(principal?.domainId ?? principal?.subject ?? '');
  }

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) return null;
    conditions.push('(created_at > ? OR (created_at = ? AND id > ?))');
    params.push(decoded.c, decoded.c, decoded.i);
  }

  let sql = 'SELECT * FROM orders';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at ASC, id ASC LIMIT ?';
  params.push(limit + 1);

  const rows = db.prepare(sql).all(...params);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  let nextCursor = null;
  if (hasMore && rows.length) {
    const last = rows[rows.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ c: last.created_at, i: last.id }),
    ).toString('base64url');
  }

  return { rows, nextCursor };
}

function insert(order) {
  insertStmt.run({
    id: order.id,
    customer_id: order.customer_id,
    service_type: order.service_type,
    weight_kg: order.weight_kg,
    pickup_address: order.pickup_address,
    status: order.status,
    outlet_id: order.outlet_id ?? null,
    created_at: order.created_at,
    updated_at: order.updated_at,
  });
}

function updateStatus(id, status, updatedAt) {
  updateStatusStmt.run({ id, status, updated_at: updatedAt });
}

/**
 * Bind an order to the outlet that took it in. Conditional on `outlet_id IS
 * NULL` so an already-claimed order can never be silently reassigned.
 */
function assignOutlet(id, outletId, updatedAt) {
  return assignOutletStmt.run({
    id,
    outlet_id: outletId,
    updated_at: updatedAt,
  }).changes;
}

module.exports = { getById, listForPrincipal, insert, updateStatus, assignOutlet };
