'use strict';

const config = require('./config');
require('./database');

const express = require('express');
const ordersRouter = require('./routes/orders');
const pickupsRouter = require('./routes/pickups');
const { authenticate } = require('./auth/authenticate');
const {
  sendProblem,
  badRequest,
  internalError,
  notFound,
} = require('./problem');
const logger = require('./logger');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

// Public: the platform probes readiness without a token.
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Layer 1 — authentication. Everything below this line needs a valid token.
app.use(authenticate);

app.use('/v1/orders', ordersRouter);
app.use('/v1/pickups', pickupsRouter);

// Unmatched API paths must still answer with Problem Details: the contract
// promises every /v1 response carries a machine-readable problem body.
app.use('/v1', (req, res) => {
  sendProblem(res, notFound(req.originalUrl));
});

app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return sendProblem(
      res,
      badRequest('Malformed JSON in request body.', req.originalUrl),
    );
  }

  logger.error('Unhandled error', {
    ...logger.requestContext(req, 500),
    reason: err.message,
  });
  sendProblem(res, internalError(req.originalUrl));
});

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`Laundry service listening on http://127.0.0.1:${config.PORT}`);
    console.log(`Health check: http://127.0.0.1:${config.PORT}/health`);
  });
}

module.exports = app;
