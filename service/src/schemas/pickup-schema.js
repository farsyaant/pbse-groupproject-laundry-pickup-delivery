'use strict';

const PICKUP_ID_RE = /^pku_[A-Za-z0-9]+$/;
const ORDER_ID_RE = /^ord_[A-Za-z0-9]+$/;
const DRIVER_ID_RE = /^drv_[A-Za-z0-9]+$/;
const ISO_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const VALID_PICKUP_STATUSES = [
  'scheduled',
  'assigned',
  'picked_up',
  'delivered',
  'cancelled',
];

function validatePickupId(id) {
  if (!id || !PICKUP_ID_RE.test(id)) {
    return 'Pickup ID must match pattern pku_[A-Za-z0-9]+';
  }
  return null;
}

function validateCreatePickup(body) {
  if (!body || typeof body !== 'object') {
    return { status: 400, errors: ['Request body must be a JSON object'], fields: [] };
  }

  const missing = [];
  if (body.orderId === undefined) missing.push('orderId is required');
  if (body.driverId === undefined) missing.push('driverId is required');
  if (body.scheduledAt === undefined) missing.push('scheduledAt is required');
  if (missing.length) {
    return { status: 400, errors: missing, fields: missing.map((error) => error.split(' ')[0]) };
  }

  const types = [];
  if (typeof body.orderId !== 'string') types.push('orderId must be a string');
  if (typeof body.driverId !== 'string') types.push('driverId must be a string');
  if (typeof body.scheduledAt !== 'string') types.push('scheduledAt must be a string');
  if (types.length) {
    return { status: 400, errors: types, fields: types.map((error) => error.split(' ')[0]) };
  }

  const domain = [];
  if (!ORDER_ID_RE.test(body.orderId)) domain.push('orderId format is invalid');
  if (!DRIVER_ID_RE.test(body.driverId)) domain.push('driverId format is invalid');
  if (!ISO_DATE_TIME_RE.test(body.scheduledAt)) {
    domain.push('scheduledAt must be an ISO 8601 date-time string');
  }
  if (domain.length) {
    return {
      status: 422,
      errors: domain,
      fields: [...new Set(domain.map((error) => error.split(' ')[0]))],
    };
  }

  return null;
}

function validateListParams({ status, limit } = {}) {
  const errors = [];

  if (status !== undefined && !VALID_PICKUP_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${VALID_PICKUP_STATUSES.join(', ')}`);
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
  validatePickupId,
  validateCreatePickup,
  validateListParams,
  VALID_PICKUP_STATUSES,
};
