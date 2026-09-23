import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash, randomUUID } from 'node:crypto';

/**
 * Verify a DEPLOYED resource server against a running authorization server.
 *
 * The authz suite proves the service logic; this proves the wiring between a
 * real provider and a real deployment. A service whose `OIDC_ISSUER`,
 * `OIDC_JWKS_URI`, or `OIDC_AUDIENCE` is wrong answers `401` to everything,
 * including valid tokens, so "no token -> 401" alone proves nothing.
 *
 * Usage:
 *   node auth/keycloak/verify-deployment.mjs \
 *     https://pbse.kevinio.my.id \
 *     https://keycloak-production-68f0.up.railway.app
 *
 * Reads fixture passwords from `auth/keycloak/.runtime/credentials.json`
 * (gitignored). No token, password, or secret is printed.
 */

const api = (process.argv[2] || '').replace(/\/+$/, '');
const kc = (process.argv[3] || 'http://localhost:8081').replace(/\/+$/, '');

assert.ok(api, 'usage: node auth/keycloak/verify-deployment.mjs <api-origin> <keycloak-origin>');

const issuer = `${kc}/realms/laundry`;
const audience = 'laundry-api';
const credentials = JSON.parse(
  await readFile(new URL('./.runtime/credentials.json', import.meta.url), 'utf8'),
);

const results = [];
let failures = 0;
const check = (ok, label) => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
};
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));

async function pkceLogin(clientId, username, scope, redirectUri) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid ${scope}`,
    state,
    nonce: randomBytes(16).toString('hex'),
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });

  const cookies = new Map();
  const withCookies = async (url, options = {}) => {
    const headers = { ...options.headers };
    const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(url, {
      ...options,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    for (const setCookie of response.headers.getSetCookie()) {
      const pair = setCookie.split(';', 1)[0];
      const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  };

  const page = await withCookies(`${issuer}/protocol/openid-connect/auth?${params}`);
  const html = await page.text();
  const action = html.match(/<form[^>]*action="([^"]+)"/i)?.[1]?.replaceAll('&amp;', '&');
  assert.ok(action, `${clientId}/${username}: login form not found`);

  const login = await withCookies(action, {
    method: 'POST',
    body: new URLSearchParams({ username, password: credentials.users[username], credentialId: '' }),
  });
  const location = login.headers.get('location');
  assert.ok(location, `${clientId}/${username}: login did not redirect`);
  const returned = new URL(location);
  assert.equal(returned.searchParams.get('state'), state, `${clientId}/${username}: state mismatch`);

  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code: returned.searchParams.get('code'),
      code_verifier: verifier,
    }),
  });
  assert.equal(response.status, 200, `${clientId}/${username}: code exchange failed`);
  return response.json();
}

async function main() {
  console.log(`resource server : ${api}`);
  console.log(`authorization   : ${issuer}`);
  console.log('');

  // Provider discovery must agree with what the service is configured to trust.
  const discovery = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();
  console.log('--- provider ---');
  console.log(`issuer   : ${discovery.issuer}`);
  console.log(`jwks_uri : ${discovery.jwks_uri}`);
  console.log(`audience : ${audience} (expected value of OIDC_AUDIENCE)`);
  console.log('');

  const WEB = ['laundry-web', 'http://localhost:5173/callback'];
  const MOBILE = ['laundry-mobile', 'id.ac.ugm.laundry://oauth/callback'];

  const studentA = await pkceLogin(MOBILE[0], 'student-a', 'orders:read orders:write', MOBILE[1]);
  const studentB = await pkceLogin(MOBILE[0], 'student-b', 'orders:read orders:write', MOBILE[1]);
  const staffA = await pkceLogin(WEB[0], 'staff-outlet-a', 'orders:read orders:fulfil', WEB[1]);

  const aClaims = decode(studentA.access_token);
  const sClaims = decode(staffA.access_token);

  console.log('--- token claims ---');
  check(typeof aClaims.sub === 'string' && aClaims.sub.length > 0, 'token carries sub');
  check(Array.isArray(aClaims.realm_access?.roles), 'token carries realm_access.roles');
  check(aClaims.fixture_domain_id === 'cus_studentA', 'fixture_domain_id = cus_studentA');
  check(sClaims.outlet_id === 'outlet_a', 'staff token carries outlet_id = outlet_a');
  check([aClaims.aud].flat().includes(audience), `audience contains ${audience}`);
  console.log('');

  const call = (token, pathname, init = {}) =>
    fetch(`${api}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(30000),
    });

  console.log('--- deployed resource server ---');
  const anon = await fetch(`${api}/v1/orders`);
  check(anon.status === 401, `no token -> 401 (got ${anon.status})`);

  // The decisive check: a valid token must be ACCEPTED. If this fails while the
  // provider above is correct, the deployment's OIDC_* variables are wrong.
  const accepted = await call(studentA.access_token, '/v1/orders');
  check(accepted.status === 200, `valid token accepted -> 200 (got ${accepted.status})`);
  if (accepted.status !== 200) {
    const body = await accepted.text();
    console.log(`     body: ${body.slice(0, 220)}`);
  }

  const forbidden = await call(studentA.access_token, '/v1/orders/ord_x/fulfilment', {
    method: 'POST',
  });
  check(forbidden.status === 403, `missing scope -> 403 (got ${forbidden.status})`);

  const forbiddenUnknown = await call(
    studentA.access_token,
    '/v1/orders/ord_doesnotexist/fulfilment',
    { method: 'POST' },
  );
  check(forbiddenUnknown.status === 403,
    `scope refused before object load (unknown id -> 403, got ${forbiddenUnknown.status})`);

  const created = await call(studentA.access_token, '/v1/orders', {
    method: 'POST',
    // The contract pins Idempotency-Key to UUID v4; a random hex string is
    // correctly rejected with 400.
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      customerId: 'cus_studentA',
      serviceType: 'wash_fold',
      weightKg: 3,
      pickupAddress: 'Jl. Verification No. 1, Jakarta',
    }),
  });
  const order = await created.json();
  check(created.status === 201, `create order -> 201 (got ${created.status})`);

  if (created.status === 201) {
    const own = await call(studentA.access_token, `/v1/orders/${order.id}`);
    check(own.status === 200, `owner reads own order -> 200 (got ${own.status})`);

    const foreign = await call(studentB.access_token, `/v1/orders/${order.id}`);
    const absent = await call(studentB.access_token, '/v1/orders/ord_doesnotexist');
    const foreignBody = await foreign.text();
    const absentBody = await absent.text();
    check(foreign.status === 404, `other caller's object -> 404 (got ${foreign.status})`);
    check(foreignBody === absentBody, 'absent and not-owned 404 bodies are identical');

    const claimRes = await call(staffA.access_token, `/v1/orders/${order.id}/fulfilment`, {
      method: 'POST',
    });
    const claimed = await claimRes.json();
    check(claimRes.status === 200, `staff fulfilment -> 200 (got ${claimRes.status})`);
    check(claimed.outletId === 'outlet_a',
      `outlet taken from token claim (got ${claimed.outletId})`);
  }

  console.log('');
  for (const line of results) console.log(line);
  console.log('');

  if (failures) {
    console.error(`Deployment verification failed: ${failures} check(s)`);
    if (accepted.status === 401) {
      console.error('');
      console.error('The provider is healthy but the service refuses a valid token.');
      console.error('Check the resource server environment:');
      console.error(`  OIDC_ISSUER=${discovery.issuer}`);
      console.error(`  OIDC_JWKS_URI=${discovery.jwks_uri}`);
      console.error(`  OIDC_AUDIENCE=${audience}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('Deployment verification passed.');
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
