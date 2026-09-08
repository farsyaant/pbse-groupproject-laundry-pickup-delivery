'use strict';

const db = require('../database');

const findByIdStmt = db.prepare('SELECT * FROM orders WHERE id = ?');

const insertStmt = db.prepare(`
  INSERT INTO orders (id, customer_id, service_type, weight_kg, pickup_address, status, created_at, updated_at)
  VALUES (@id, @customer_id, @service_type, @weight_kg, @pickup_address, @status, @created_at, @updated_at)
`);

const updateStatusStmt = db.prepare(
  'UPDATE orders SET status = @status, updated_at = @updated_at WHERE id = @id',
);

function getById(id) {
  return findByIdStmt.get(id) || null;
}

function getAll({ status, limit = 20, cursor } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (cursor) {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      );
      conditions.push(
        '(created_at > ? OR (created_at = ? AND id > ?))',
      );
      params.push(decoded.c, decoded.c, decoded.i);
    } catch {
      return null;
    }
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
  insertStmt.run(order);
}

function updateStatus(id, status, updatedAt) {
  updateStatusStmt.run({ id, status, updated_at: updatedAt });
}

module.exports = { getById, getAll, insert, updateStatus };
