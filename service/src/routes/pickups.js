'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const pickupStore = require('../store/pickup-store');
const orderStore = require('../store/order-store');
const { toPickupRepresentation } = require('../representation/pickup');
const {
  validatePickupId,
  validateCreatePickup,
  validateListParams,
} = require('../schemas/pickup-schema');
const {
  sendProblem,
  badRequest,
  notFound,
  unprocessable,
} = require('../problem');
const { requireScope } = require('../auth/require-scope');
const { mayClaimOrder, mayCollectPickup } = require('../auth/ownership');
const {
  checkIdempotency,
  claimIdempotency,
  saveIdempotencyRecord,
} = require('../idempotency');

function generateId(prefix) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `${prefix}${ts}${rand}`;
}

function sendPickupNotFound(res) {
  return sendProblem(res, notFound('/v1/pickups/{pickupId}'));
}

router.get('/', requireScope('pickups:read'), (req, res) => {
  const { status, limit, cursor } = req.query;

  const errors = validateListParams({ status, limit });
  if (errors) {
    return sendProblem(res, badRequest(errors.join('; '), req.originalUrl));
  }

  const parsedLimit = limit ? parseInt(limit, 10) : 20;
  const result = pickupStore.listForPrincipal(req.principal, {
    status,
    limit: parsedLimit,
    cursor,
  });

  if (result === null) {
    return sendProblem(res, badRequest('Invalid cursor value.', req.originalUrl));
  }

  if (result.nextCursor) {
    res.set('X-Next-Cursor', result.nextCursor);
  }

  res.status(200).json(result.rows.map(toPickupRepresentation));
});

// Staff-only dispatch (scope `orders:fulfil`). The order named in the body is
// loaded and checked against the caller's outlet before anything is written.
router.post('/', requireScope('orders:fulfil'), (req, res) => {
  const idem = checkIdempotency(req);
  if (idem.error) {
    if (idem.retryAfter) res.set('Retry-After', String(idem.retryAfter));
    return sendProblem(res, idem.error);
  }
  if (idem.replay) {
    const cached = JSON.parse(idem.body);
    if (cached.id) res.set('Location', `/v1/pickups/${cached.id}`);
    return res.status(idem.status).json(cached);
  }

  const validation = validateCreatePickup(req.body);
  if (validation) {
    const problem =
      validation.status === 422
        ? unprocessable(validation.errors.join('; '), req.originalUrl, {
            invalidFields: validation.fields,
          })
        : badRequest(validation.errors.join('; '), req.originalUrl, {
            invalidFields: validation.fields,
          });
    return sendProblem(res, problem);
  }

  const order = orderStore.getById(req.body.orderId);
  // Absent order and order belonging to another outlet are indistinguishable.
  if (!order || !mayClaimOrder(req.principal, order)) {
    return sendProblem(res, notFound('/v1/orders/{orderId}'));
  }

  const claim = claimIdempotency(idem.key, idem.hash, req.originalUrl);
  if (claim) {
    if (claim.retryAfter) res.set('Retry-After', String(claim.retryAfter));
    if (claim.replay) return res.status(claim.status).json(JSON.parse(claim.body));
    return sendProblem(res, claim.error);
  }

  const now = new Date().toISOString();
  const pickup = {
    id: generateId('pku_'),
    order_id: order.id,
    driver_id: req.body.driverId,
    scheduled_at: req.body.scheduledAt,
    address: order.pickup_address,
    status: 'assigned',
    collected_at: null,
    created_at: now,
    updated_at: now,
  };

  pickupStore.insert(pickup);

  // Binding the order to the outlet is part of dispatching it.
  if (order.outlet_id === null) {
    orderStore.assignOutlet(order.id, req.principal.outletId, now);
  }

  const representation = toPickupRepresentation(pickup);
  saveIdempotencyRecord(idem.key, idem.hash, 201, JSON.stringify(representation));

  res
    .status(201)
    .set('Location', `/v1/pickups/${pickup.id}`)
    .json(representation);
});

// Driver-only collection (scope `pickups:write`). The ownership check runs
// before the write: a refused request must leave the row untouched.
router.post('/:pickupId/collect', requireScope('pickups:write'), (req, res) => {
  const { pickupId } = req.params;

  const err = validatePickupId(pickupId);
  if (err) return sendProblem(res, badRequest(err, req.originalUrl));

  const pickup = pickupStore.getById(pickupId);
  if (!pickup) return sendPickupNotFound(res);

  if (!mayCollectPickup(req.principal, pickup)) {
    return sendPickupNotFound(res);
  }

  if (pickup.status !== 'picked_up') {
    const now = new Date().toISOString();
    pickupStore.markCollected(pickupId, now, now);
  }

  res.status(200).json(toPickupRepresentation(pickupStore.getById(pickupId)));
});

module.exports = router;
