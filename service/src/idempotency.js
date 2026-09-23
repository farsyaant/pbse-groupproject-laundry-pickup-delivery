'use strict';

const crypto = require('crypto');
const idempotencyStore = require('./store/idempotency-store');
const { badRequest, idempotencyConflict } = require('./problem');

const RETENTION_MS = 24 * 60 * 60 * 1000;

function bodyHash(body) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
}

function validateKey(key) {
  const UUID_V4_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  if (!key) return 'Idempotency-Key header is required';
  if (!UUID_V4_RE.test(key)) return 'Idempotency-Key must be a valid UUID v4';
  return null;
}

function checkIdempotency(req) {
  const key = req.headers['idempotency-key'];
  const keyError = validateKey(key);
  if (keyError) return { error: badRequest(keyError, req.originalUrl) };

  const hash = bodyHash(req.body);
  const record = idempotencyStore.findByKey(key);

  if (record && new Date(record.expires_at) >= new Date()) {
    if (record.body_hash !== hash) {
      return {
        error: idempotencyConflict(
          'Idempotency-Key was reused with different request data.',
          req.originalUrl,
        ),
      };
    }
    if (record.request_status === 'processing') {
      return {
        error: idempotencyConflict(
          'A request with this Idempotency-Key is still being processed.',
          req.originalUrl,
        ),
        retryAfter: 5,
      };
    }
    if (record.request_status === 'completed') {
      return {
        replay: true,
        status: record.response_status,
        body: record.response_body,
      };
    }
  }

  return { proceed: true, key, hash };
}

function claimIdempotency(key, hash, instance) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + RETENTION_MS).toISOString();
  if (idempotencyStore.claim(key, hash, now, expiresAt)) return null;

  const current = idempotencyStore.findByKey(key);
  if (current && current.body_hash !== hash) {
    return {
      error: idempotencyConflict(
        'Idempotency-Key was reused with different request data.',
        instance,
      ),
    };
  }
  if (current && current.request_status === 'processing') {
    return {
      error: idempotencyConflict(
        'A request with this Idempotency-Key is still being processed.',
        instance,
      ),
      retryAfter: 5,
    };
  }
  if (current && current.request_status === 'completed') {
    return { replay: true, status: current.response_status, body: current.response_body };
  }
  return {
    error: idempotencyConflict(
      'A request with this Idempotency-Key is unavailable.',
      instance,
    ),
  };
}

function saveIdempotencyRecord(key, hash, responseStatus, responseBody) {
  idempotencyStore.markCompleted(key, responseStatus, responseBody);
}

module.exports = {
  bodyHash,
  checkIdempotency,
  claimIdempotency,
  saveIdempotencyRecord,
};
