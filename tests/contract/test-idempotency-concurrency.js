'use strict';

/**
 * Idempotency under concurrency: five simultaneous POSTs sharing one
 * Idempotency-Key must produce a single entity and a single database row.
 *
 * P4 only adds a bearer token; the concurrency behaviour is unchanged.
 *
 * Run with:  node tests/contract/test-idempotency-concurrency.js
 */

const crypto = require('node:crypto');
const path = require('node:path');

const {
  freePort,
  startTestIssuer,
  startService,
  waitForHealth,
  tempDatabaseFile,
  removeDatabase,
  stopChild,
  serviceDir,
} = require('../helpers/harness');

const Database = require(path.join(serviceDir, 'node_modules', 'better-sqlite3'));

const issuerPort = freePort(8);
const servicePort = freePort(9);
const databaseFile = tempDatabaseFile('concurrency');

const key = crypto.randomUUID();
const customerId = `cus_concurrency${crypto.randomBytes(6).toString('hex')}`;
const payload = {
  customerId,
  serviceType: 'wash_fold',
  weightKg: 2.5,
  pickupAddress: 'Test concurrency address',
};

async function main() {
  const issuer = await startTestIssuer({ port: issuerPort });
  const token = await issuer.token('student-a', {
    domainId: customerId,
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

  try {
    await waitForHealth(servicePort, () => serviceOutput);

    const baseUrl = `http://127.0.0.1:${servicePort}/v1`;
    const requests = Array.from({ length: 5 }, () => fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    }));
    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const statuses = responses.map((response) => response.status);
    const createdIds = bodies.filter((body) => body.id).map((body) => body.id);
    const uniqueIds = new Set(createdIds);

    if (statuses.some((status) => ![201, 409].includes(status))) {
      throw new Error(`Unexpected statuses: ${statuses.join(', ')}`);
    }
    if (uniqueIds.size > 1) {
      throw new Error(`Concurrent requests created multiple entities: ${[...uniqueIds].join(', ')}`);
    }

    const db = new Database(databaseFile, { readonly: true });
    const rowCount = db.prepare('SELECT COUNT(*) AS count FROM orders WHERE customer_id = ?').get(customerId).count;
    db.close();

    if (rowCount !== 1) {
      throw new Error(`Expected exactly one database row, got ${rowCount}`);
    }

    console.log(JSON.stringify({
      requestCount: requests.length,
      statuses,
      uniqueIds: [...uniqueIds],
      databaseRows: rowCount,
    }));
  } finally {
    await stopChild(service);
    await issuer.close();
    removeDatabase(databaseFile);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
