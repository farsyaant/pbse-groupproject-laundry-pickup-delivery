'use strict';

const { sendProblem, unauthorized, forbidden } = require('../problem');

function requireScope(...requiredScopes) {
  return (req, res, next) => {
    if (!req.principal) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return sendProblem(res, unauthorized(req.originalUrl));
    }

    const hasScopes = requiredScopes.every((scope) =>
      req.principal.scopes.includes(scope),
    );
    if (!hasScopes) {
      res.set(
        'WWW-Authenticate',
        `Bearer error="insufficient_scope", scope="${requiredScopes.join(' ')}"`,
      );
      return sendProblem(res, forbidden(req.originalUrl, requiredScopes));
    }

    return next();
  };
}

module.exports = { requireScope };
