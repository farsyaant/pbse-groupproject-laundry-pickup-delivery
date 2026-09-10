'use strict';

const crypto = require('crypto');
const path = require('path');
const Database = require(path.resolve(__dirname, '../../service/node_modules/better-sqlite3'));

const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8080/v1').replace(/\/+$/, '');
const key = crypto.randomUUID();
const customerId = `cus_concurrency${crypto.randomBytes(6).toString('hex')}`;
const payload = {
  customerId,
  serviceType: 'wash_fold',
  weightKg: 2.5,
  pickupAddress: 'Test concurrency address',
};

async function main() {
  const requests = Array.from({ length: 5 }, () => fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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

  const databaseFile = process.env.DATABASE_FILE || './service/db/laundry.sqlite';
  const db = new Database(path.resolve(process.cwd(), databaseFile), { readonly: true });
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
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
