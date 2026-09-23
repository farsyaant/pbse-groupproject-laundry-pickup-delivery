'use strict';

/**
 * Run the Session 3 contract suite against a live service that now requires
 * authentication.
 *
 * The contract itself is unchanged: this runner only supplies the token the
 * client would present, which is what the assignment asks for ("those tests
 * must now send a token; adjust the runner's configuration, not the contract").
 *
 * The service is booted against the test-only issuer from tests/helpers, so the
 * check needs no network access to a live authorization server.
 *
 * Run with:  node tests/contract/run-against-service.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  freePort,
  startTestIssuer,
  startService,
  waitForHealth,
  tempDatabaseFile,
  removeDatabase,
  stopChild,
  root,
} = require('../helpers/harness');

const issuerPort = freePort(2);
const servicePort = freePort(3);
const databaseFile = tempDatabaseFile('contract');

async function main() {
  const issuer = await startTestIssuer({ port: issuerPort });

  // The contract suite creates orders for this customer id, so the token must
  // be bound to the same domain identity.
  const token = await issuer.token('student-a', {
    domainId: 'cus_01HZX2Y1AB',
    scopes: ['orders:read', 'orders:write'],
  });

  const service = startService({
    port: servicePort,
    databaseFile,
    issuer: issuer.issuer,
    jwksUri: issuer.jwksUri,
    audience: issuer.audience,
  });
  let serviceOutput = '';
  service.stdout.on('data', (chunk) => { serviceOutput += chunk.toString(); });
  service.stderr.on('data', (chunk) => { serviceOutput += chunk.toString(); });

  let exitCode = 1;
  try {
    await waitForHealth(servicePort, () => serviceOutput);

    exitCode = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(root, 'tests', 'contract', 'test-contract.js')],
        {
          cwd: root,
          env: {
            ...process.env,
            BASE_URL: `http://127.0.0.1:${servicePort}/v1`,
            IS_LIVE: 'true',
            AUTH_TOKEN: token,
          },
          stdio: 'inherit',
        },
      );
      child.on('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    await stopChild(service);
    await issuer.close();
    removeDatabase(databaseFile);
  }

  assert.equal(exitCode, 0, 'contract suite must pass against the authenticated service');
  console.log('Contract suite passed against the authenticated live service.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
