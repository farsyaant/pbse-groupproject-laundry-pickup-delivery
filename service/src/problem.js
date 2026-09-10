'use strict';

function createProblem(type, title, status, detail, instance, extras) {
  const body = { type, title, status, detail, instance };
  if (extras) Object.assign(body, extras);
  return body;
}

function sendProblem(res, problem) {
  res.status(problem.status).type('application/problem+json').json(problem);
}

function badRequest(detail, instance, extras) {
  return createProblem(
    'https://api.example.com/problems/bad-request',
    'Bad request',
    400,
    detail,
    instance,
    extras,
  );
}

function notFound(detail, instance) {
  return createProblem(
    'https://api.example.com/problems/not-found',
    'Resource not found',
    404,
    detail,
    instance,
  );
}

function idempotencyConflict(detail, instance) {
  return createProblem(
    'https://api.example.com/problems/idempotency-conflict',
    'Idempotency key conflict',
    409,
    detail,
    instance,
  );
}

function orderNotCancellable(detail, instance, currentStatus, allowedStatuses) {
  return createProblem(
    'https://api.example.com/problems/order-not-cancellable',
    'Order cannot be cancelled',
    409,
    detail,
    instance,
    { currentStatus, allowedStatuses },
  );
}

function unprocessable(detail, instance, extras) {
  return createProblem(
    'https://api.example.com/problems/validation-failed',
    'Validation failed',
    422,
    detail,
    instance,
    extras,
  );
}

function internalError(instance) {
  return createProblem(
    'https://api.example.com/problems/internal-error',
    'Internal server error',
    500,
    'An unexpected error occurred.',
    instance,
  );
}

module.exports = {
  createProblem,
  sendProblem,
  badRequest,
  notFound,
  idempotencyConflict,
  orderNotCancellable,
  unprocessable,
  internalError,
};
