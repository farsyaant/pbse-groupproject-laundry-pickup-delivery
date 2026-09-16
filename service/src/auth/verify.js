'use strict';

const { createRemoteJWKSet, jwtVerify } = require('jose');
const config = require('../config');

const jwks = createRemoteJWKSet(new URL(config.OIDC_JWKS_URI));

async function verifyAccessToken(rawToken) {
  const { payload } = await jwtVerify(rawToken, jwks, {
    issuer: config.OIDC_ISSUER,
    audience: config.OIDC_AUDIENCE,
    algorithms: ['RS256'],
    clockTolerance: 5,
  });

  return payload;
}

module.exports = { verifyAccessToken };
