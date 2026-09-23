'use strict';

const db = require('../database');

const findByIdStmt = db.prepare('SELECT * FROM pickups WHERE id = ?');

const findByOrderIdStmt = db.prepare(
  'SELECT * FROM pickups WHERE order_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
);

const insertStmt = db.prepare(`
  INSERT INTO pickups (id, order_id, driver_id, scheduled_at, address, status, collected_at, created_at, updated_at)
  VALUES (@id, @order_id, @driver_id, @scheduled_at, @address, @status, @collected_at, @created_at, @updated_at)
`);

const markCollectedStmt = db.prepare(`
  UPDATE pickups
  SET status = @status, collected_at = @collected_at, updated_at = @updated_at
  WHERE id = @id
`);

function getById(id) {
  return findByIdStmt.get(id) || null;
}

function getByOrderId(orderId) {
  return findByOrderIdStmt.get(orderId) || null;
}

function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * List pickups visible to a principal. Drivers see only their own
 * assignments; staff see every pickup for an order belonging to their outlet.
 * The restriction is part of the SQL query.
 */
function listForPrincipal(principal, { status, limit = 20, cursor } = {}) {
  const conditions = [];
  const params = [];

  // A principal bound to an outlet sees the pickups of that outlet's orders;
  // a driver sees only their own assignments.
  if (principal?.outletId) {
    conditions.push(
      'order_id IN (SELECT id FROM orders WHERE outlet_id = ?)',
    );
    params.push(principal.outletId);
  } else {
    conditions.push('driver_id = ?');
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

  let sql = 'SELECT * FROM pickups';
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

function insert(pickup) {
  insertStmt.run({
    id: pickup.id,
    order_id: pickup.order_id,
    driver_id: pickup.driver_id,
    scheduled_at: pickup.scheduled_at,
    address: pickup.address,
    status: pickup.status,
    collected_at: pickup.collected_at ?? null,
    created_at: pickup.created_at,
    updated_at: pickup.updated_at,
  });
}

function markCollected(id, collectedAt, updatedAt) {
  markCollectedStmt.run({
    id,
    status: 'picked_up',
    collected_at: collectedAt,
    updated_at: updatedAt,
  });
}

module.exports = {
  getById,
  getByOrderId,
  listForPrincipal,
  insert,
  markCollected,
};
