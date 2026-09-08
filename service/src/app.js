'use strict';

const config = require('./config');
require('./database');

const express = require('express');
const ordersRouter = require('./routes/orders');
const { sendProblem, badRequest, internalError } = require('./problem');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/v1/orders', ordersRouter);

app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return sendProblem(
      res,
      badRequest('Malformed JSON in request body.', req.originalUrl),
    );
  }

  console.error('Unhandled error:', err.stack || err.message);
  sendProblem(res, internalError(req.originalUrl));
});

app.listen(config.PORT, () => {
  console.log(`Laundry service listening on http://127.0.0.1:${config.PORT}`);
  console.log(`Health check: http://127.0.0.1:${config.PORT}/health`);
});
