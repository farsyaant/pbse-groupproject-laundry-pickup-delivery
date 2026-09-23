'use strict';

/**
 * Shared test harness for the P4 authorization work.
 *
 * Provides three things every test needs, and nothing else:
 *   1. a test-only RS256 signing key whose public JWKS is served locally, so
 *      CI never depends on network access to a live authorization server;
 *   2. a token factory for the six fixture principals;
 *   3. a service launcher wired to that issuer.
 *
 * The private key exists only inside the test process. The issuer value is
 * test-only, so a token minted here can never be accepted by a real running
 * service.
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const serviceDir = path.join(root, 'service');

const { exportJWK, generateKeyPair, SignJWT } = require(
  path.join(serviceDir, 'node_modules', 'jose'),
);

const TEST_AUDIENCE = 'laundry-api-test';

/**
 * Fixture principals. `domainId` is the domain identity the provider binds to
 * the subject; `outletId` is present only for staff, because a staff principal
 * acts for exactly one outlet.
 */
const FIXTURES = {
  'student-a': { domainId: 'cus_studentA', roles: ['customer'], scopes: ['orders:read', 'orders:write'] },
  'student-b': { domainId: 'cus_studentB', roles: ['customer'], scopes: ['orders:read', 'orders:write'] },
  'courier-a': { domainId: 'drv_courierA', roles: ['driver'], scopes: ['pickups:read', 'pickups:write'] },
  'courier-b': { domainId: 'drv_courierB', roles: ['driver'], scopes: ['pickups:read', 'pickups:write'] },
  'staff-outlet-a': { domainId: 'outlet_a', outletId: 'outlet_a', roles: ['staff'], scopes: ['orders:read', 'pickups:read', 'orders:fulfil'] },
  'staff-outlet-b': { domainId: 'outlet_b', outletId: 'outlet_b', roles: ['staff'], scopes: ['orders:read', 'pickups:read', 'orders:fulfil'] },
};

function freePort(offset = 0) {
  return 18100 + ((process.pid + offset) % 2000);
}

async function startTestIssuer({ port }) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'authz-test',
    alg: 'RS256',
    use: 'sig',
  };

  const server = http.createServer((req, res) => {
    if (req.url === '/jwks') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const issuer = `http://127.0.0.1:${port}/test-issuer`;
  const jwksUri = `http://127.0.0.1:${port}/jwks`;

  /**
   * Mint an access token.
   * @param {string} subject
   * @param {{domainId?: string, outletId?: string|null, scopes?: string[],
   *          roles?: string[], expiresIn?: string, issuer?: string,
   *          audience?: string}} [overrides]
   */
  function token(subject, overrides = {}) {
    const fixture = FIXTURES[subject] || {};
    const payload = {
      scope: (overrides.scopes ?? fixture.scopes ?? []).join(' '),
      fixture_domain_id: overrides.domainId ?? fixture.domainId ?? subject,
      realm_access: { roles: overrides.roles ?? fixture.roles ?? [] },
    };
    const outletId = overrides.outletId ?? fixture.outletId ?? null;
    if (outletId) payload.outlet_id = outletId;

    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'authz-test' })
      .setIssuer(overrides.issuer ?? issuer)
      .setAudience(overrides.audience ?? TEST_AUDIENCE)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? '5m')
      .sign(privateKey);
  }

  /** Re-sign a token's payload while keeping the original signature. */
  function editPayload(rawToken, replacementPayload) {
    const parts = rawToken.split('.');
    const forged = Buffer.from(JSON.stringify(replacementPayload)).toString('base64url');
    return `${parts[0]}.${forged}.${parts[2]}`;
  }

  return {
    server,
    issuer,
    jwksUri,
    audience: TEST_AUDIENCE,
    token,
    editPayload,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function startService({ port, databaseFile, issuer, jwksUri, audience, extraEnv = {} }) {
  // Only tests/authz/verify-checks-are-live.js sets AUTHZ_DISABLE_CHECK; when it
  // is absent this adds nothing. The fault injection itself lives in
  // tests/helpers/disable-check.js, never in the service source.
  const preload = process.env.AUTHZ_DISABLE_CHECK
    ? `--require ${path.join(__dirname, 'disable-check.js')}`
    : '';

  return spawn(process.execPath, ['src/app.js'], {
    cwd: serviceDir,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_FILE: databaseFile,
      NODE_ENV: 'test',
      OIDC_ISSUER: issuer,
      OIDC_JWKS_URI: jwksUri,
      OIDC_AUDIENCE: audience,
      ...(preload ? { NODE_OPTIONS: preload } : {}),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHealth(port, getError) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status === 200) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const detail = getError?.();
  throw new Error(`Service did not become healthy${detail ? `: ${detail}` : ''}`);
}

function tempDatabaseFile(label) {
  return path.join(os.tmpdir(), `laundry-${label}-${process.pid}-${Date.now()}.sqlite`);
}

function removeDatabase(databaseFile) {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databaseFile}${suffix}`, { force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
}

module.exports = {
  FIXTURES,
  freePort,
  startTestIssuer,
  startService,
  waitForHealth,
  tempDatabaseFile,
  removeDatabase,
  stopChild,
  root,
  serviceDir,
};
