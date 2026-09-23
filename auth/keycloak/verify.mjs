import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash, createPublicKey, verify } from 'node:crypto';

const origin = 'http://localhost:8081';
const issuer = `${origin}/realms/laundry`;
const credentials = JSON.parse(await readFile(new URL('./.runtime/credentials.json', import.meta.url)));
const results = [];
const check = (condition, label) => { assert.ok(condition, label); results.push(label); };
async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'manual' });
}
async function token(realm, params) {
  const response = await request(`${origin}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams(params),
  });
  const data = await response.json();
  return { response, data };
}
async function main() {
  const { response: adminResponse, data: admin } = await token('master', {
    grant_type: 'password', client_id: 'admin-cli', username: 'laundry-admin', password: credentials.admin,
  });
  assert.equal(adminResponse.status, 200, 'Local admin login failed');
  const getAdmin = async path => {
    const response = await request(`${origin}/admin/realms/laundry${path}`, {
      headers: { Authorization: `Bearer ${admin.access_token}` },
    });
    assert.equal(response.status, 200, 'Admin inspection failed');
    return response.json();
  };
  const realm = await getAdmin('');
  check(realm.revokeRefreshToken && realm.refreshTokenMaxReuse === 0, 'Rotation enabled; maximum reuse is zero');
  check(realm.accessTokenLifespan === 300, 'Access-token lifespan is 300 seconds');
  const allClients = await getAdmin('/clients');
  for (const id of ['laundry-web', 'laundry-mobile']) {
    const c = allClients.find(c => c.clientId === id);
    check(c?.publicClient && c.standardFlowEnabled && !c.directAccessGrantsEnabled &&
      !c.implicitFlowEnabled && !c.serviceAccountsEnabled && c.attributes['pkce.code.challenge.method'] === 'S256', `${id}: public, S256, no password/implicit/service-account grant`);
    check(c.redirectUris.length === 1 && !c.redirectUris[0].includes('*'), `${id}: one exact callback`);
  }
  const users = await getAdmin('/users?max=100');
  for (const name of Object.keys(credentials.users)) {
    const user = users.find(u => u.username === name && u.enabled);
    check(Boolean(user), `${name}: enabled`);
    const roles = await getAdmin(`/users/${user.id}/role-mappings/realm`);
    const expected = name.startsWith('student') ? 'customer' : name.startsWith('courier') ? 'driver' : 'staff';
    check(roles.some(r => r.name === expected), `${name}: expected role assigned`);
  }
  const scopes = await getAdmin('/client-scopes');
  for (const name of ['orders:read', 'orders:write', 'pickups:read', 'orders:fulfil', 'pickups:write']) {
    const scope = scopes.find(s => s.name === name);
    assert.ok(scope, 'Contract scope exists');
    const roles = await getAdmin(`/client-scopes/${scope.id}/scope-mappings/realm`);
    check(roles.some(r => r.name === name), `${name}: scope restricted by role`);
  }
  const discoveryResponse = await request(`${issuer}/.well-known/openid-configuration`);
  const discovery = await discoveryResponse.json();
  check(discovery.issuer === issuer, 'Discovery issuer matches');
  const jwksResponse = await request(discovery.jwks_uri);
  const jwks = await jwksResponse.json();
  function claims(jwt) {
    const [header, payload, signature] = jwt.split('.');
    const h = JSON.parse(Buffer.from(header, 'base64url'));
    assert.equal(h.alg, 'RS256');
    const jwk = jwks.keys.find(k => k.kid === h.kid);
    assert.ok(jwk, 'Signing key exists');
    assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url')), 'Signature valid');
    const c = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(c.iss, issuer);
    assert.ok([c.aud].flat().includes('laundry-api'));
    assert.ok(c.exp > Date.now() / 1000);
    return c;
  }
  const job = await token('laundry', { grant_type: 'client_credentials', client_id: 'laundry-scheduled-job',
    client_secret: credentials.scheduledJob, scope: 'orders:read pickups:read' });
  assert.equal(job.response.status, 200);
  const jobScopes = claims(job.data.access_token).scope.split(' ');
  check(['orders:read', 'pickups:read'].every(s => jobScopes.includes(s)) && !jobScopes.some(s => s.endsWith(':write') || s.endsWith(':fulfil')) && !job.data.refresh_token,
    'Scheduled job: signed audience-bound read token, no write scope or refresh token');

  // Local fixture login through Authorization Code + PKCE; never enable password grant.
  for (const [client, username, scope, callback, expected] of [
    ['laundry-web', 'student-a', 'orders:read orders:fulfil', 'http://localhost:5173/callback',
      { actor: 'customer', fixture_domain_id: 'cus_studentA', outlet_id: undefined }],
    ['laundry-mobile', 'student-a', 'orders:read orders:write pickups:write', 'id.ac.ugm.laundry://oauth/callback',
      { actor: 'customer', fixture_domain_id: 'cus_studentA', outlet_id: undefined }],
    // Staff must carry the outlet binding in the token, or every outlet-scoped
    // ownership rule would compare a username against an outlet identifier.
    ['laundry-web', 'staff-outlet-a', 'orders:read orders:fulfil', 'http://localhost:5173/callback',
      { actor: 'staff', fixture_domain_id: 'outlet_a', outlet_id: 'outlet_a' }],
  ]) {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const params = new URLSearchParams({ client_id: client, redirect_uri: callback, response_type: 'code',
      scope: `openid ${scope}`, state, nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    const cookies = new Map();
    const withCookies = async (url, opts = {}) => {
      const response = await request(url, { ...opts, headers: { ...opts.headers, Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') } });
      for (const c of response.headers.getSetCookie()) { const part = c.split(';')[0]; const index = part.indexOf('='); cookies.set(part.slice(0,index), part.slice(index+1)); }
      return response;
    };
    const page = await withCookies(`${issuer}/protocol/openid-connect/auth?${params}`);
    const html = await page.text();
    const action = html.match(/<form[^>]*action="([^"]+)"/i)?.[1]?.replaceAll('&amp;', '&');
    assert.ok(action, 'Login form exists');
    assert.equal(new URL(action).origin, origin, 'Credentials stay on local provider');
    const login = await withCookies(action, { method: 'POST', body: new URLSearchParams({ username, password: credentials.users[username], credentialId: '' }) });
    const location = login.headers.get('location');
    assert.ok(location?.startsWith(`${callback}?`), `${client}: login returns to registered callback`);
    const returned = new URL(location);
    assert.equal(returned.searchParams.get('state'), state);
    const code = returned.searchParams.get('code');
    assert.ok(code, 'Authorization code exists');
    const exchanged = await token('laundry', { grant_type: 'authorization_code', client_id: client,
      redirect_uri: callback, code, code_verifier: verifier });
    assert.equal(exchanged.response.status, 200, 'PKCE code exchange succeeds');
    const grantedClaims = claims(exchanged.data.access_token);
    const granted = grantedClaims.scope.split(' ');

    // The identity claims the resource server maps into its internal
    // principal. These must come from the token, never from the request.
    //
    // `sub` is checked first and deliberately: without the built-in `basic`
    // client scope there is no `sub`, `principal.js` throws, and every real
    // token is refused with 401 regardless of the other claims.
    check(typeof grantedClaims.sub === 'string' && grantedClaims.sub.length > 0,
      `${client}/${username}: token carries a sub claim`);
    check(Array.isArray(grantedClaims.realm_access?.roles),
      `${client}/${username}: token carries realm_access.roles`);
    check(grantedClaims.realm_access.roles.includes(expected.actor),
      `${client}/${username}: realm_access.roles includes '${expected.actor}'`);
    check(grantedClaims.fixture_domain_id === expected.fixture_domain_id,
      `${client}/${username}: fixture_domain_id claim is ${expected.fixture_domain_id}`);
    if (expected.outlet_id) {
      check(grantedClaims.outlet_id === expected.outlet_id,
        `${client}/${username}: outlet_id claim is ${expected.outlet_id}`);
    } else {
      check(grantedClaims.outlet_id === undefined,
        `${client}/${username}: no outlet_id claim for a non-staff principal`);
    }
    check(!granted.includes('laundry-identity'),
      `${client}/${username}: identity scope is not exposed as a capability scope`);

    // Scope is granted from the user's role, not from what the client asked for.
    // `student-a` must not receive `orders:fulfil`; `staff-outlet-a` must not
    // receive `orders:write`.
    const mustNotHave = username.startsWith('staff') ? 'orders:write' : 'orders:fulfil';
    check(granted.includes('orders:read') && !granted.includes(mustNotHave),
      `${client}/${username}: requested scope outside the role is not granted`);

    check(Boolean(exchanged.data.refresh_token), `${client}/${username}: PKCE login issues refresh token`);
    for (const method of ['missing', 'plain']) {
      const invalid = new URLSearchParams(params);
      if (method === 'missing') { invalid.delete('code_challenge'); invalid.delete('code_challenge_method'); }
      else invalid.set('code_challenge_method', 'plain');
      const response = await request(`${issuer}/protocol/openid-connect/auth?${invalid}`);
      const redirect = response.headers.get('location');
      check(response.status === 400 || Boolean(redirect && new URL(redirect).searchParams.get('error')), `${client}: rejects ${method} PKCE`);
    }
  }
  for (const result of results) console.log(`PASS ${result}`);
  console.log('Refresh reuse/family-revocation sequence remains for stage 10. No token or secret output.');
}
main().catch(error => {
  console.error('FAIL Keycloak setup verification. No credentials or token responses printed.');
  console.error(error.stack?.split('\n').find(line => line.includes('verify.mjs:')) || 'Request failed.');
  process.exitCode = 1;
});
