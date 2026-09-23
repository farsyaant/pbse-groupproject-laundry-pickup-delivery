'use strict';

/**
 * End-to-end proof that the identity claims really make object authorization
 * work against a live Keycloak.
 *
 * The unit suite mints tokens from a test key and injects `fixture_domain_id`
 * directly, so it passes even when the provider never publishes that claim.
 * This script closes that blind spot: it logs in through Authorization Code +
 * PKCE against the running Keycloak, then drives the real service with the
 * resulting tokens.
 *
 * Run with a local Keycloak up:  node auth/keycloak/e2e-proof.mjs
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SERVICE_DIR = path.join(ROOT, 'service');
const KC = 'http://localhost:8081';
const ISSUER = `${KC}/realms/laundry`;
const AUDIENCE = 'laundry-api';
const SERVICE_PORT = 18777;

const credentials = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '.runtime', 'credentials.json'), 'utf8'),
);

const results = [];
let failures = 0;
const check = (ok, label) => {
  if (ok) results.push(`PASS ${label}`);
  else {
    failures += 1;
    results.push(`FAIL ${label}`);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Authorization Code + PKCE login; returns the token response body. */
async function pkceLogin(clientId, username, scope, redirectUri) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid ${scope}`,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
  });

  const cookies = new Map();
  const withCookies = async (url, opts = {}) => {
    const res = await fetch(url, {
      ...opts,
      redirect: 'manual',
      headers: {
        ...opts.headers,
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const part = c.split(';')[0];
      const i = part.indexOf('=');
      cookies.set(part.slice(0, i), part.slice(i + 1));
    }
    return res;
  };

  const page = await withCookies(`${ISSUER}/protocol/openid-connect/auth?${params}`);
  const html = await page.text();
  const action = html
    .match(/<form[^>]*action="([^"]+)"/i)?.[1]
    ?.replaceAll('&amp;', '&');
  assert.ok(action, 'login form must exist');

  const login = await withCookies(action, {
    method: 'POST',
    body: new URLSearchParams({
      username,
      password: credentials.users[username],
      credentialId: '',
    }),
  });

  const location = login.headers.get('location');
  assert.ok(location, `login must redirect for ${username}`);
  const code = new URL(location).searchParams.get('code');
  assert.ok(code, 'authorization code must exist');

  const tokenRes = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  assert.equal(tokenRes.status, 200, 'PKCE exchange must succeed');
  return tokenRes.json();
}

function startService() {
  return spawn(process.execPath, ['src/app.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      PORT: String(SERVICE_PORT),
      DATABASE_FILE: './db/e2e-proof.sqlite',
      NODE_ENV: 'test',
      OIDC_ISSUER: ISSUER,
      OIDC_JWKS_URI: `${ISSUER}/protocol/openid-connect/certs`,
      OIDC_AUDIENCE: AUDIENCE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${SERVICE_PORT}/health`);
      if (res.status === 200) return;
    } catch {
      /* still starting */
    }
    await sleep(150);
  }
  throw new Error('service did not become healthy');
}

async function main() {
  // Client/scope pairing must respect each client's registered optional scopes:
  // `laundry-web` is the staff client and cannot request `orders:write`, while
  // `laundry-mobile` carries the customer/driver capabilities.
  const WEB = ['laundry-web', 'http://localhost:5173/callback'];
  const MOBILE = ['laundry-mobile', 'id.ac.ugm.laundry://oauth/callback'];

  console.log('logging in through Keycloak (PKCE)...');
  const studentA = await pkceLogin(MOBILE[0], 'student-a', 'orders:read orders:write', MOBILE[1]);
  const studentB = await pkceLogin(MOBILE[0], 'student-b', 'orders:read orders:write', MOBILE[1]);
  const staffA = await pkceLogin(WEB[0], 'staff-outlet-a', 'orders:read orders:fulfil', WEB[1]);

  const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));

  // The claim the resource server maps into principal.domainId. If Keycloak
  // does not publish it, principal.js falls back to `sub` and every ownership
  // comparison is username-vs-domainId, which answers 404 for everything.
  const aClaims = decode(studentA.access_token);
  const staffClaims = decode(staffA.access_token);
  check(aClaims.fixture_domain_id === 'cus_studentA',
    `student-a token carries fixture_domain_id=cus_studentA (got ${aClaims.fixture_domain_id})`);
  check(staffClaims.outlet_id === 'outlet_a',
    `staff-outlet-a token carries outlet_id=outlet_a (got ${staffClaims.outlet_id})`);
  check([aClaims.aud].flat().includes(AUDIENCE),
    `token audience contains ${AUDIENCE}`);

  const service = startService();
  let output = '';
  service.stdout.on('data', (c) => { output += c.toString(); });
  service.stderr.on('data', (c) => { output += c.toString(); });

  const base = `http://127.0.0.1:${SERVICE_PORT}`;
  const call = (token, pathname, init = {}) =>
    fetch(`${base}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

  try {
    await waitForHealth();

    // Layer 2: student token on a staff-only operation.
    const forbidden = await call(aClaims.scope.includes('orders:fulfil') ? studentB.access_token : studentA.access_token,
      '/v1/orders/ord_x/fulfilment', { method: 'POST' });
    check(forbidden.status === 403, `student on staff-only fulfilment -> 403 (got ${forbidden.status})`);

    // Layer 3: the whole point of the mapper. student-a creates an order for its
    // own domain identity, which the contract validates as ^cus_[A-Za-z0-9]+$.
    const created = await call(studentA.access_token, '/v1/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        customerId: 'cus_studentA',
        serviceType: 'wash_fold',
        weightKg: 3,
        pickupAddress: 'Jl. E2E No. 1, Jakarta',
      }),
    });
    const order = await created.json();
    check(created.status === 201,
      `student-a creates an order for cus_studentA -> 201 (got ${created.status}${created.status !== 201 ? ` ${JSON.stringify(order)}` : ''})`);
    check(order.customerId === 'cus_studentA',
      `created order carries customerId=cus_studentA (got ${order.customerId})`);

    if (created.status === 201) {
      // Owner can read it.
      const own = await call(studentA.access_token, `/v1/orders/${order.id}`);
      check(own.status === 200, `owner reads own order -> 200 (got ${own.status})`);

      // Another student cannot, and the answer is the same as for an absent id.
      const foreign = await call(studentB.access_token, `/v1/orders/${order.id}`);
      const absent = await call(studentB.access_token, '/v1/orders/ord_doesnotexist');
      const foreignBody = await foreign.text();
      const absentBody = await absent.text();
      check(foreign.status === 404, `student-b reading student-a order -> 404 (got ${foreign.status})`);
      check(foreignBody === absentBody, 'absent and not-owned 404 bodies are identical');

      // Staff claims the order into their own outlet, read from the token.
      const claimRes = await call(staffA.access_token, `/v1/orders/${order.id}/fulfilment`, {
        method: 'POST',
      });
      const claimed = await claimRes.json();
      check(claimRes.status === 200, `staff fulfilment -> 200 (got ${claimRes.status})`);
      check(claimed.outletId === 'outlet_a',
        `order bound to outlet_a from the token claim (got ${claimed.outletId})`);

      // The owner must still be able to read the order after the outlet claimed it.
      const afterClaim = await call(studentA.access_token, `/v1/orders/${order.id}`);
      check(afterClaim.status === 200,
        `owner still reads own order after outlet claimed it -> 200 (got ${afterClaim.status})`);
    }

    // No token at all still refuses.
    const anon = await fetch(`${base}/v1/orders`);
    check(anon.status === 401, `no token -> 401 (got ${anon.status})`);

    // Tokens must not reach the service log.
    const leaked = [studentA.access_token, studentB.access_token, staffA.access_token]
      .some((t) => output.includes(t));
    check(!leaked, 'service log contains no issued token');
  } finally {
    service.kill();
    await sleep(500);
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(
        path.join(SERVICE_DIR, 'db', `e2e-proof.sqlite${suffix}`),
        { force: true },
      );
    }
  }

  console.log('');
  for (const line of results) console.log(line);
  if (failures) {
    console.error('\n--- service output (for diagnosis) ---');
    console.error(output);
    console.error(`\nE2E proof failed: ${failures} check(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('\nE2E proof passed: real Keycloak tokens drive object authorization correctly.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
