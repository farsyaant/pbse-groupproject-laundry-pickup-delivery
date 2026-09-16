'use strict';

const { verifyAccessToken } = require('./verify');
const { principalFromClaims } = require('./principal');
const { sendProblem, unauthorized } = require('../problem');
const logger = require('../logger');

async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';

  if (!header) {
    req.principal = null;
    return next();
  }

  if (!/^Bearer\s+\S+$/.test(header)) {
    res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
    return sendProblem(res, unauthorized(req.originalUrl));
  }

  try {
    const claims = await verifyAccessToken(header.slice(7).trim());
    req.principal = principalFromClaims(claims);
    return next();
  } catch (error) {
    // Log only a stable reason. Never log the token or request headers.
    res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
    logger.warn('Rejected bearer token', {
      ...logger.requestContext(req, 401),
      reason: error.code || error.name || 'invalid_token',
    });
    return sendProblem(res, unauthorized(req.originalUrl));
  }
}

module.exports = { authenticate };
