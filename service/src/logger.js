'use strict';

const SENSITIVE_KEYS = new Set(['authorization', 'cookie', 'set-cookie']);

function sanitizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : value,
    ]),
  );
}

function requestContext(req, status) {
  return {
    method: req.method,
    path: req.originalUrl,
    status,
    correlationId: req.get('x-correlation-id') || undefined,
  };
}

function warn(message, context = {}) {
  console.warn(message, sanitizeHeaders(context));
}

function error(message, context = {}) {
  console.error(message, sanitizeHeaders(context));
}

module.exports = { error, requestContext, sanitizeHeaders, warn };
