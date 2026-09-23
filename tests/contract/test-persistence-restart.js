'use strict';

/**
 * Persistence check: create three entities, restart the service, read all
 * three back. P4 only adds a bearer token to the same requests, so the contract
 * behaviour under test is unchanged.
 *
 * Run with:  node tests/contract/test-persistence-restart.js
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
} = require('../helpers/harness');

const issuerPort = freePort(6);
const port = freePort(7);
const databaseFile = tempDatabaseFile('persistence');

const orders = [1, 2, 3].map((number) => {
  const suffix = crypto.randomBytes(4).toString('hex');
  return {
    customerId: `cus_restart${number}${suffix}`,
    serviceType: 'wash_fold',
    weightKg: number + 1.5,
    pickupAddress: `Restart test address ${number}`,
  };
});

let child = null;

async function main() {
  const issuer = await startTestIssuer({ port: issuerPort });
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  // One token per fixture customer: the service binds each token to a domain
  // identity, so an order may only be created for the identity it names.
  const tokens = new Map();
  for (const order of orders) {
    tokens.set(order.customerId, await issuer.token('student-a', {
      domainId: order.customerId,
      scopes: ['orders:read', 'orders:write'],
    }));
  }

  const boot = () => startService({
    port,
    databaseFile,
    issuer: issuer.issuer,
    jwksUri: issuer.jwksUri,
    audience: issuer.audience,
  });

  const tokenByOrderId = new Map();

  async function createOrder(order) {
    const response = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.get(order.customerId)}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(order),
    });
    if (response.status !== 201) throw new Error(`Create failed with ${response.status}`);
    const created = await response.json();
    // Remember which customer owns the created order so it can be read back
    // with that customer's token.
    tokenByOrderId.set(created.id, tokens.get(order.customerId));
    return created;
  }

  async function readOrder(id) {
    const response = await fetch(`${baseUrl}/orders/${id}`, {
      headers: { Authorization: `Bearer ${tokenByOrderId.get(id)}` },
    });
    if (response.status !== 200) throw new Error(`Read failed with ${response.status}`);
    return response.json();
  }

  try {
    child = boot();
    await waitForHealth(port);

    const created = [];
    for (const order of orders) {
      created.push(await createOrder(order));
    }
    const ids = created.map((order) => order.id);

    await stopChild(child);
    child = boot();
    await waitForHealth(port);

    const restored = await Promise.all(ids.map(readOrder));

    if (restored.length !== 3 || restored.some((order, index) => order.id !== ids[index])) {
      throw new Error('Not all three orders survived restart');
    }

    console.log(JSON.stringify({ createdIds: ids, restoredIds: restored.map((order) => order.id) }));
  } finally {
    await stopChild(child);
    await issuer.close();
    removeDatabase(databaseFile);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
