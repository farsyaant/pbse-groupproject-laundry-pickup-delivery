'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { exportJWK, generateKeyPair, SignJWT } = require(path.join(
  __dirname,
  '..',
  '..',
  'service',
  'node_modules',
  'jose',
));

const root = path.resolve(__dirname, '..', '..');
const serviceDir = path.join(root, 'service');
const dbFile = path.join(os.tmpdir(), `laundry-authz-${process.pid}.sqlite`);
const servicePort = 18080 + (process.pid % 1000);
const issuer = `http://127.0.0.1:${servicePort}/test-issuer`;
const audience = 'laundry-api-test';

async function main() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'authz-test', alg: 'RS256', use: 'sig' };
  const jwksServer = http.createServer((req, res) => {
    if (req.url === '/jwks') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    res.statusCode = 404;
    return res.end();
  });
  await new Promise((resolve) => jwksServer.listen(servicePort, '127.0.0.1', resolve));

  const service = require('node:child_process').spawn(process.execPath, ['src/app.js'], {
    cwd: serviceDir,
    env: {
      ...process.env,
      PORT: String(servicePort + 1),
      DATABASE_FILE: dbFile,
      NODE_ENV: 'test',
      OIDC_ISSUER: issuer,
      OIDC_JWKS_URI: `${issuer.replace('/test-issuer', '')}/jwks`,
      OIDC_AUDIENCE: audience,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serviceError = '';
  service.stderr.on('data', (chunk) => {
    serviceError += chunk.toString();
  });

  try {
    await waitForHealth(servicePort + 1, () => serviceError);
    const base = `http://127.0.0.1:${servicePort + 1}`;
    const noToken = await fetch(`${base}/v1/orders`);
    assert.equal(noToken.status, 401);

    const readA = await token('student-a', 'cus_studentA', ['orders:read']);
    const writeA = await token('student-a', 'cus_studentA', ['orders:write']);
    const writeB = await token('student-b', 'cus_studentB', ['orders:write']);

    const missingScope = await fetch(`${base}/v1/orders`, {
      headers: { Authorization: `Bearer ${writeA}` },
    });
    assert.equal(missingScope.status, 403);

    const payload = {
      customerId: 'cus_studentB',
      serviceType: 'wash_fold',
      weightKg: 2,
      pickupAddress: 'Test address',
    };
    const orderResponse = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${writeB}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    assert.equal(orderResponse.status, 201);
    const order = await orderResponse.json();

    const foreignOrder = await fetch(`${base}/v1/orders/${order.id}`, {
      headers: { Authorization: `Bearer ${readA}` },
    });
    assert.equal(foreignOrder.status, 404);
    const absentOrder = await fetch(`${base}/v1/orders/ord_doesnotexist`, {
      headers: { Authorization: `Bearer ${readA}` },
    });
    assert.equal(absentOrder.status, 404);
    assert.deepEqual(await foreignOrder.json(), await absentOrder.json());

    const edited = `${readA.slice(0, readA.indexOf('.') + 1)}${Buffer.from('{"sub":"attacker"}').toString('base64url')}${readA.slice(readA.lastIndexOf('.'))}`;
    const editedResponse = await fetch(`${base}/v1/orders`, {
      headers: { Authorization: `Bearer ${edited}` },
    });
    assert.equal(editedResponse.status, 401);
    
        // --- Tambahan: /health tetap public ---
    const healthCheck = await fetch(`${base}/health`);
    assert.equal(healthCheck.status, 200);

    // --- Tambahan: expired token → 401 ---
    const expiredToken = await token('student-a', 'cus_studentA', ['orders:read'], 'expired');
    const expiredResponse = await fetch(`${base}/v1/orders`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredResponse.status, 401);

    // --- Tambahan: unauthorized write tidak mengubah database ---
    const beforeCancel = await fetch(`${base}/v1/orders/${order.id}`, {
      headers: { Authorization: `Bearer ${writeB}` },
    });
    const beforeCancelBody = await beforeCancel.json();

    const cancelAttempt = await fetch(`${base}/v1/orders/${order.id}/cancellation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${writeA}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
    });
    assert.equal(cancelAttempt.status, 404);

    const afterCancel = await fetch(`${base}/v1/orders/${order.id}`, {
      headers: { Authorization: `Bearer ${writeB}` },
    });
    const afterCancelBody = await afterCancel.json();
    assert.deepEqual(beforeCancelBody, afterCancelBody);

    // --- Tambahan: token tidak bocor di response error ---
    const errorBodyText = await (await fetch(`${base}/v1/orders`, {
      headers: { Authorization: `Bearer ${edited}` },
    })).text();
    assert.ok(!errorBodyText.includes(edited));

    console.log('Authz tests passed');
  } finally {
    service.kill();
    jwksServer.close();
    await new Promise((resolve) => {
      if (service.exitCode !== null) return resolve();
      service.once('exit', resolve);
    });
    for (const file of [dbFile, `${dbFile}-shm`, `${dbFile}-wal`]) {
      fs.rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  async function token(subject, domainId, scopes, expiresIn = '5m') {
    const builder = new SignJWT({ scope: scopes.join(' '), fixture_domain_id: domainId })
      .setProtectedHeader({ alg: 'RS256', kid: 'authz-test' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt();

    if (expiresIn === 'expired') {
      // Timestamp 1 jam yang lalu, dalam detik (Unix epoch)
      builder.setExpirationTime(Math.floor(Date.now() / 1000) - 3600);
    } else {
      builder.setExpirationTime(expiresIn);
    }

    return builder.sign(privateKey);
  }
}

async function waitForHealth(port, getError) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Service did not become healthy${getError?.() ? `: ${getError()}` : ''}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
