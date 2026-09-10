'use strict';

const ORDER_ID_RE = /^ord_[A-Za-z0-9]+$/;
const CUSTOMER_ID_RE = /^cus_[A-Za-z0-9]+$/;
const UUID_V4_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const VALID_SERVICE_TYPES = ['wash_fold', 'dry_clean', 'iron_only'];
const VALID_ORDER_STATUSES = [
  'pending_pickup',
  'ready_for_pickup',
  'confirmed',
  'assigned',
  'picked_up',
  'processing',
  'completed',
  'cancelled',
];

function validateOrderId(id) {
  if (!id || !ORDER_ID_RE.test(id)) {
    return 'Order ID must match pattern ord_[A-Za-z0-9]+';
  }
  return null;
}

function validateIdempotencyKey(key) {
  if (!key) return 'Idempotency-Key header is required';
  if (!UUID_V4_RE.test(key)) return 'Idempotency-Key must be a valid UUID v4';
  return null;
}

function validateCreateOrder(body) {
  if (!body || typeof body !== 'object') {
    return { status: 400, errors: ['Request body must be a JSON object'], fields: [] };
  }

  const missing = [];
  if (body.customerId === undefined) missing.push('customerId is required');
  if (body.serviceType === undefined) missing.push('serviceType is required');
  if (body.weightKg === undefined || body.weightKg === null)
    missing.push('weightKg is required');
  if (body.pickupAddress === undefined)
    missing.push('pickupAddress is required');
  if (missing.length) return { status: 400, errors: missing, fields: missing.map((error) => error.split(' ')[0]) };

  const types = [];
  if (typeof body.customerId !== 'string')
    types.push('customerId must be a string');
  if (typeof body.serviceType !== 'string')
    types.push('serviceType must be a string');
  if (typeof body.weightKg !== 'number')
    types.push('weightKg must be a number');
  if (typeof body.pickupAddress !== 'string')
    types.push('pickupAddress must be a string');
  if (types.length) return { status: 400, errors: types, fields: types.map((error) => error.split(' ')[0]) };

  const domain = [];
  if (!CUSTOMER_ID_RE.test(body.customerId))
    domain.push('customerId format is invalid');
  if (!VALID_SERVICE_TYPES.includes(body.serviceType))
    domain.push(
      `serviceType must be one of: ${VALID_SERVICE_TYPES.join(', ')}`,
    );
  if (body.weightKg < 0.1) domain.push('weightKg must be at least 0.1');
  if (body.pickupAddress.trim().length === 0)
    domain.push('pickupAddress must not be empty');
  if (domain.length) return { status: 422, errors: domain, fields: [...new Set(domain.map((error) => error.split(' ')[0]))] };

  return null;
}

function validateListParams({ status, limit } = {}) {
  const errors = [];

  if (status !== undefined && !VALID_ORDER_STATUSES.includes(status)) {
    errors.push(
      `status must be one of: ${VALID_ORDER_STATUSES.join(', ')}`,
    );
  }

  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      errors.push('limit must be an integer between 1 and 100');
    }
  }

  return errors.length ? errors : null;
}

module.exports = {
  validateOrderId,
  validateIdempotencyKey,
  validateCreateOrder,
  validateListParams,
  VALID_ORDER_STATUSES,
};
