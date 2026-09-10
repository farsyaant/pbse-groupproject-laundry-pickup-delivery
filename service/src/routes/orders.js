'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const orderStore = require('../store/order-store');
const idempotencyStore = require('../store/idempotency-store');
const cancellationStore = require('../store/cancellation-store');
const { toOrderRepresentation } = require('../representation/order');
const {
  toCancellationRepresentation,
} = require('../representation/cancellation');
const {
  validateOrderId,
  validateIdempotencyKey,
  validateCreateOrder,
  validateListParams,
} = require('../schemas/order-schema');
const {
  sendProblem,
  badRequest,
  notFound,
  idempotencyConflict,
  orderNotCancellable,
  unprocessable,
} = require('../problem');

function generateId(prefix) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `${prefix}${ts}${rand}`;
}

function bodyHash(body) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
}

function checkIdempotency(req) {
  const key = req.headers['idempotency-key'];
  const keyError = validateIdempotencyKey(key);
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
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  if (idempotencyStore.claim(key, hash, now, expiresAt)) return null;

  const current = idempotencyStore.findByKey(key);
  if (current && current.body_hash !== hash) {
    return { error: idempotencyConflict('Idempotency-Key was reused with different request data.', instance) };
  }
  if (current && current.request_status === 'processing') {
    return { error: idempotencyConflict('A request with this Idempotency-Key is still being processed.', instance), retryAfter: 5 };
  }
  if (current && current.request_status === 'completed') {
    return { replay: true, status: current.response_status, body: current.response_body };
  }
  return { error: idempotencyConflict('A request with this Idempotency-Key is unavailable.', instance) };
}

function saveIdempotencyRecord(key, hash, responseStatus, responseBody) {
  idempotencyStore.markCompleted(key, responseStatus, responseBody);
}

router.get('/:orderId', (req, res) => {
  const { orderId } = req.params;
  const err = validateOrderId(orderId);
  if (err) return sendProblem(res, badRequest(err, req.originalUrl));

  const row = orderStore.getById(orderId);
  if (!row) {
    return sendProblem(
      res,
      notFound(`Order ${orderId} does not exist.`, req.originalUrl),
    );
  }

  res.status(200).json(toOrderRepresentation(row));
});

router.get('/', (req, res) => {
  const { status, limit, cursor } = req.query;

  const errors = validateListParams({ status, limit });
  if (errors) {
    return sendProblem(res, badRequest(errors.join('; '), req.originalUrl));
  }

  const parsedLimit = limit ? parseInt(limit, 10) : 20;
  const result = orderStore.getAll({ status, limit: parsedLimit, cursor });

  if (result === null) {
    return sendProblem(res, badRequest('Invalid cursor value.', req.originalUrl));
  }

  if (result.nextCursor) {
    res.set('X-Next-Cursor', result.nextCursor);
  }

  res.status(200).json(result.rows.map(toOrderRepresentation));
});

router.post('/', (req, res) => {
  const idem = checkIdempotency(req);
  if (idem.error) {
    if (idem.retryAfter) res.set('Retry-After', String(idem.retryAfter));
    return sendProblem(res, idem.error);
  }
  if (idem.replay) {
    const cached = JSON.parse(idem.body);
    if (cached.id) res.set('Location', `/v1/orders/${cached.id}`);
    return res.status(idem.status).json(cached);
  }

  const validation = validateCreateOrder(req.body);
  if (validation) {
    const problem =
      validation.status === 422
        ? unprocessable(validation.errors.join('; '), req.originalUrl, { invalidFields: validation.fields })
        : badRequest(validation.errors.join('; '), req.originalUrl, { invalidFields: validation.fields });
    return sendProblem(res, problem);
  }

  const claim = claimIdempotency(idem.key, idem.hash, req.originalUrl);
  if (claim) {
    if (claim.retryAfter) res.set('Retry-After', String(claim.retryAfter));
    if (claim.replay) return res.status(claim.status).json(JSON.parse(claim.body));
    return sendProblem(res, claim.error);
  }

  const now = new Date().toISOString();
  const orderId = generateId('ord_');
  const order = {
    id: orderId,
    customer_id: req.body.customerId,
    service_type: req.body.serviceType,
    weight_kg: req.body.weightKg,
    pickup_address: req.body.pickupAddress,
    status: 'pending_pickup',
    created_at: now,
    updated_at: now,
  };

  orderStore.insert(order);

  const representation = toOrderRepresentation(order);
  saveIdempotencyRecord(idem.key, idem.hash, 201, JSON.stringify(representation));

  res
    .status(201)
    .set('Location', `/v1/orders/${orderId}`)
    .json(representation);
});

const CANCELLABLE = ['pending_pickup', 'ready_for_pickup', 'confirmed'];

router.post('/:orderId/cancellation', (req, res) => {
  const { orderId } = req.params;

  const idErr = validateOrderId(orderId);
  if (idErr) return sendProblem(res, badRequest(idErr, req.originalUrl));

  const idem = checkIdempotency(req);
  if (idem.error) {
    if (idem.retryAfter) res.set('Retry-After', String(idem.retryAfter));
    return sendProblem(res, idem.error);
  }
  if (idem.replay) {
    return res.status(idem.status).json(JSON.parse(idem.body));
  }

  const order = orderStore.getById(orderId);
  if (!order) {
    return sendProblem(
      res,
      notFound(`Order ${orderId} does not exist.`, req.originalUrl),
    );
  }

  if (!CANCELLABLE.includes(order.status)) {
    return sendProblem(
      res,
      orderNotCancellable(
        `Order cannot be cancelled because it is in '${order.status}' status.`,
        req.originalUrl,
        order.status,
        CANCELLABLE,
      ),
    );
  }

  const claim = claimIdempotency(idem.key, idem.hash, req.originalUrl);
  if (claim) {
    if (claim.retryAfter) res.set('Retry-After', String(claim.retryAfter));
    if (claim.replay) return res.status(claim.status).json(JSON.parse(claim.body));
    return sendProblem(res, claim.error);
  }

  const now = new Date().toISOString();
  orderStore.updateStatus(orderId, 'cancelled', now);

  const cancellation = {
    id: generateId('can_'),
    order_id: orderId,
    reason: 'Customer requested cancellation',
    status: 'completed',
    created_at: now,
  };
  cancellationStore.insert(cancellation);

  const representation = toCancellationRepresentation(cancellation);
  saveIdempotencyRecord(idem.key, idem.hash, 200, JSON.stringify(representation));

  res.status(200).json(representation);
});

module.exports = router;
