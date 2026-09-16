'use strict';

function principalFromClaims(claims) {
  if (!claims.sub) throw new Error('Token is missing subject');

  const roles = [
    ...(Array.isArray(claims.realm_access?.roles) ? claims.realm_access.roles : []),
    ...(Array.isArray(claims.resource_access?.[claims.azp]?.roles)
      ? claims.resource_access[claims.azp].roles
      : []),
  ];

  return {
    subject: claims.sub,
    domainId: claims.fixture_domain_id || claims.sub,
    kind: claims.azp === claims.sub || claims.clientId ? 'service' : 'user',
    roles,
    scopes: String(claims.scope || '').split(' ').filter(Boolean),
    tokenId: claims.jti || null,
  };
}

module.exports = { principalFromClaims };
