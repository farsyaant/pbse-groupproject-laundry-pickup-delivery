'use strict';

const db = require('../database');

const findByKeyStmt = db.prepare(
  'SELECT * FROM idempotency_records WHERE key = ?',
);

const insertStmt = db.prepare(`
  INSERT INTO idempotency_records
    (key, body_hash, request_status, response_status, response_body, created_at, expires_at)
  VALUES (@key, @body_hash, @request_status, @response_status, @response_body, @created_at, @expires_at)
`);

const markCompletedStmt = db.prepare(`
  UPDATE idempotency_records
  SET request_status = 'completed',
      response_status = @response_status,
      response_body   = @response_body
  WHERE key = @key
`);

const deleteExpiredStmt = db.prepare(
  'DELETE FROM idempotency_records WHERE key = ? AND expires_at < ?',
);

const claimStmt = db.prepare(`
  INSERT OR IGNORE INTO idempotency_records
    (key, body_hash, request_status, created_at, expires_at)
  VALUES (@key, @body_hash, 'processing', @created_at, @expires_at)
`);

function findByKey(key) {
  return findByKeyStmt.get(key) || null;
}

function insert(record) {
  insertStmt.run({
    key: record.key,
    body_hash: record.body_hash,
    request_status: record.request_status,
    response_status: record.response_status ?? null,
    response_body: record.response_body ?? null,
    created_at: record.created_at,
    expires_at: record.expires_at,
  });
}

function markCompleted(key, responseStatus, responseBody) {
  markCompletedStmt.run({
    key,
    response_status: responseStatus,
    response_body: responseBody,
  });
}

function claim(key, bodyHash, now, expiresAt) {
  deleteExpiredStmt.run(key, now);
  return claimStmt.run({
    key,
    body_hash: bodyHash,
    created_at: now,
    expires_at: expiresAt,
  }).changes === 1;
}

module.exports = { findByKey, insert, markCompleted, claim };
