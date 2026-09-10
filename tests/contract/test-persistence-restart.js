'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const serviceRoot = path.resolve(__dirname, '../../service');
const port = 18080 + Math.floor(Math.random() * 1000);
const databaseFile = path.join(os.tmpdir(), `laundry-p3-${crypto.randomUUID()}.sqlite`);
const baseUrl = `http://127.0.0.1:${port}/v1`;
const orders = [1, 2, 3].map((number) => ({
  customerId: `cus_restart${number}${crypto.randomBytes(4).toString('hex')}`,
  serviceType: 'wash_fold',
  weightKg: number + 1.5,
  pickupAddress: `Restart test address ${number}`,
}));

let child;

function startService() {
  child = spawn(process.execPath, ['src/app.js'], {
    cwd: serviceRoot,
    env: { ...process.env, PORT: String(port), DATABASE_FILE: databaseFile, NODE_ENV: 'test' },
    stdio: 'ignore',
  });
}

function stopService() {
  if (child && !child.killed) child.kill();
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status === 200) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Service did not become healthy within 5 seconds');
}

async function createOrder(order) {
  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(order),
  });
  if (response.status !== 201) throw new Error(`Create failed with ${response.status}`);
  return response.json();
}

async function readOrder(id) {
  const response = await fetch(`${baseUrl}/orders/${id}`);
  if (response.status !== 200) throw new Error(`Read failed with ${response.status}`);
  return response.json();
}

async function main() {
  try {
    startService();
    await waitForHealth();
    const created = await Promise.all(orders.map(createOrder));
    const ids = created.map((order) => order.id);

    stopService();
    child = null;
    startService();
    await waitForHealth();
    const restored = await Promise.all(ids.map(readOrder));

    if (restored.length !== 3 || restored.some((order, index) => order.id !== ids[index])) {
      throw new Error('Not all three orders survived restart');
    }

    console.log(JSON.stringify({ createdIds: ids, restoredIds: restored.map((order) => order.id) }));
  } finally {
    stopService();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(`${databaseFile}${suffix}`);
      } catch {
        // Temporary database may already be removed.
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
