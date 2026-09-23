import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';

/**
 * Step 10 evidence: refresh-token rotation and family revocation.
 *
 * Usage:
 *   node auth/keycloak/test-refresh-rotation.mjs                          # localhost:8081
 *   node auth/keycloak/test-refresh-rotation.mjs https://keycloak.example.com
 *
 * User passwords come from `auth/keycloak/.runtime/credentials.json`, which is
 * gitignored. No refresh-token value or raw token response is ever printed.
 */

const origin = (process.argv[2] || 'http://localhost:8081').replace(/\/+$/, '');
const issuer = `${origin}/realms/laundry`;
const credentials = JSON.parse(await readFile(new URL('./.runtime/credentials.json', import.meta.url), 'utf8'));
const evidence = [];

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(30000), redirect: 'manual' });
}

async function token(params) {
  const response = await request(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams(params),
  });
  const data = await response.json();
  return { response, data };
}

async function authorizationCode(clientId, username, password, scope, redirectUri) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid ${scope}`,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const cookies = new Map();
  const withCookies = async (url, options = {}) => {
    const headers = { ...options.headers };
    const cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    const response = await request(url, { ...options, headers });
    for (const setCookie of response.headers.getSetCookie()) {
      const pair = setCookie.split(';', 1)[0];
      const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  };
  const page = await withCookies(`${issuer}/protocol/openid-connect/auth?${params}`);
  const html = await page.text();
  const actionValue = html.match(/<form[^>]*action="([^"]+)"/i)?.[1];
  assert.ok(actionValue, `${clientId}: login form exists`);
  const action = actionValue.replaceAll('&amp;', '&');
  const login = await withCookies(action, {
    method: 'POST',
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  const location = login.headers.get('location');
  assert.ok(location?.startsWith(`${redirectUri}?`), `${clientId}: callback matches exact redirect URI`);
  const callback = new URL(location);
  assert.equal(callback.searchParams.get('state'), state, `${clientId}: state matches`);
  const code = callback.searchParams.get('code');
  assert.ok(code, `${clientId}: authorization code exists`);
  const exchanged = await token({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  });
  assert.equal(exchanged.response.status, 200, `${clientId}: code exchange succeeds`);
  assert.ok(exchanged.data.refresh_token, `${clientId}: refresh token issued`);
  return exchanged.data.refresh_token;
}

async function testClient(clientId, username, redirectUri) {
  const requestedScope = clientId === 'laundry-web' ? 'orders:read' : 'orders:read orders:write';
  const rt1 = await authorizationCode(clientId, username, credentials.users[username], requestedScope, redirectUri);
  const first = await token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: rt1 });
  assert.equal(first.response.status, 200, `${clientId}: RT1 refresh succeeds`);
  const rt2 = first.data.refresh_token;
  assert.ok(rt2 && rt2 !== rt1, `${clientId}: RT2 differs from RT1`);
  const reuse = await token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: rt1 });
  assert.equal(reuse.response.status, 400, `${clientId}: reused RT1 is rejected`);
  assert.equal(reuse.data.error, 'invalid_grant', `${clientId}: reuse returns invalid_grant`);
  const family = await token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: rt2 });
  assert.equal(family.response.status, 400, `${clientId}: RT2 is rejected after RT1 reuse`);
  assert.equal(family.data.error, 'invalid_grant', `${clientId}: family revocation returns invalid_grant`);
  evidence.push(`${clientId}: RT1 -> RT2 rotation passed; RT1 reuse rejected; RT2 rejected after family revocation`);
}

try {
  await testClient('laundry-web', 'student-a', 'http://localhost:5173/callback');
  await testClient('laundry-mobile', 'student-a', 'id.ac.ugm.laundry://oauth/callback');
  for (const line of evidence) console.log(`PASS ${line}`);
  console.log('No refresh-token values or raw token responses were printed.');
} catch (error) {
  console.error('FAIL refresh-token rotation evidence. No refresh-token values or raw responses were printed.');
  console.error(error.stack?.split('\n').find(line => line.includes('test-refresh-rotation.mjs:')) || 'Provider request failed.');
  process.exitCode = 1;
}
