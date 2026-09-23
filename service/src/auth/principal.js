'use strict';

function principalFromClaims(claims) {
  if (!claims.sub) throw new Error('Token is missing subject');

  const roles = [
    ...(Array.isArray(claims.realm_access?.roles) ? claims.realm_access.roles : []),
    ...(Array.isArray(claims.resource_access?.[claims.azp]?.roles)
      ? claims.resource_access[claims.azp].roles
      : []),
  ];

  const domainId = claims.fixture_domain_id || claims.sub;

  // A staff principal acts for exactly one outlet. The outlet identifier comes
  // from a provider claim; it is never derived from the request, because a
  // caller must not be able to pick which outlet they act for.
  const outletId =
    claims.outlet_id || (roles.includes('staff') ? domainId : null);

  return {
    subject: claims.sub,
    domainId,
    outletId,
    kind: claims.azp === claims.sub || claims.clientId ? 'service' : 'user',
    roles,
    scopes: String(claims.scope || '').split(' ').filter(Boolean),
    tokenId: claims.jti || null,
  };
}

module.exports = { principalFromClaims };
