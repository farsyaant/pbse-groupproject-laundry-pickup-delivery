'use strict';

const crypto = require('crypto');

const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8080/v1').replace(/\/+$/, '');
const key = crypto.randomUUID();
const payload = {
  customerId: 'cus_concurrency001',
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

  console.log(JSON.stringify({ statuses, uniqueIds: [...uniqueIds] }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
