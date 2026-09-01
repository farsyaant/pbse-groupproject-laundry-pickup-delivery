/**
 * Contract Testing Suite for Role B (Integration Owner - Faris)
 * 
 * Tests API contract compliance against Prism Mock Server (http://127.0.0.1:4010).
 * Uses native Node.js fetch (Node.js 18+).
 * 
 * Usage:
 *   node tests/contract/test-contract.js
 *   BASE_URL="http://127.0.0.1:4010" node tests/contract/test-contract.js
 */

const crypto = require('crypto');

// Configuration - easily adjustable when OpenAPI paths update
const CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://127.0.0.1:4010',
  endpoints: {
    collection: process.env.ENDPOINT_COLLECTION || '/v1/orders',
    filterParam: process.env.ENDPOINT_FILTER || 'status=completed',
    createOrder: process.env.ENDPOINT_CREATE || '/v1/orders',
  },
  samplePayload: {
    customer_id: 'cust_12345',
    service_type: 'wash_fold',
    weight_kg: 5.5,
    pickup_address: 'Jl. Merdeka No. 10, Jakarta',
  },
};

// Simple test reporter counters
let passed = 0;
let failed = 0;

function logHeader(title) {
  console.log(`\n==================================================`);
  console.log(` [TEST SCENARIO] ${title}`);
  console.log(`==================================================`);
}

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log(`Starting Contract Tests against Target: ${CONFIG.baseUrl}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    // ----------------------------------------------------
    // Skenario 1: GET Collection (e.g. GET /v1/orders)
    // ----------------------------------------------------
    logHeader('Skenario 1: GET Collection (Status 200 & valid JSON array/collection)');
    const urlCollection = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}`;
    console.log(`Request: GET ${urlCollection}`);

    const res1 = await fetch(urlCollection, {
      headers: { Accept: 'application/json' },
    });

    assert(res1.status === 200, `Expected status 200, got ${res1.status}`);
    
    const contentType1 = res1.headers.get('content-type') || '';
    assert(
      contentType1.includes('application/json'),
      `Expected Content-Type application/json, got "${contentType1}"`
    );

    const data1 = await res1.json();
    assert(
      Array.isArray(data1) || (typeof data1 === 'object' && data1 !== null),
      `Expected JSON array or object collection, got ${typeof data1}`
    );
    console.log(`Response body preview:`, JSON.stringify(data1).slice(0, 150));

    // ----------------------------------------------------
    // Skenario 2: GET with filter (e.g. GET /v1/orders?status=completed)
    // ----------------------------------------------------
    logHeader(`Skenario 2: GET with Filter (${CONFIG.endpoints.filterParam})`);
    const urlFilter = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}?${CONFIG.endpoints.filterParam}`;
    console.log(`Request: GET ${urlFilter}`);

    const res2 = await fetch(urlFilter, {
      headers: { Accept: 'application/json' },
    });

    assert(res2.status === 200, `Expected status 200, got ${res2.status}`);
    
    const contentType2 = res2.headers.get('content-type') || '';
    assert(
      contentType2.includes('application/json'),
      `Expected Content-Type application/json, got "${contentType2}"`
    );

    const data2 = await res2.json();
    assert(
      data2 !== null && typeof data2 === 'object',
      `Expected valid JSON response for filtered request`
    );
    console.log(`Response body preview:`, JSON.stringify(data2).slice(0, 150));

    // ----------------------------------------------------
    // Skenario 3: POST unsafe with Idempotency-Key
    // ----------------------------------------------------
    logHeader('Skenario 3: POST unsafe WITH Idempotency-Key (Status 200 or 201)');
    const urlPost = `${CONFIG.baseUrl}${CONFIG.endpoints.createOrder}`;
    const idempotencyKey = crypto.randomUUID();
    console.log(`Request: POST ${urlPost}`);
    console.log(`Header Idempotency-Key: ${idempotencyKey}`);

    const res3 = await fetch(urlPost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(CONFIG.samplePayload),
    });

    assert(
      res3.status === 200 || res3.status === 201,
      `Expected status 200 or 201, got ${res3.status}`
    );

    const data3 = await res3.json();
    assert(
      data3 !== null && typeof data3 === 'object',
      `Expected valid created/returned order object`
    );
    console.log(`Response body preview:`, JSON.stringify(data3).slice(0, 150));

    // ----------------------------------------------------
    // Skenario 4: POST unsafe WITHOUT Idempotency-Key
    // ----------------------------------------------------
    logHeader('Skenario 4: POST unsafe WITHOUT Idempotency-Key (Rejection with RFC 9457 Problem Details)');
    console.log(`Request: POST ${urlPost} (No Idempotency-Key header)`);

    const res4 = await fetch(urlPost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/problem+json',
      },
      body: JSON.stringify(CONFIG.samplePayload),
    });

    assert(
      [400, 409, 422].includes(res4.status),
      `Expected rejection status 400, 409, or 422, got ${res4.status}`
    );

    const contentType4 = res4.headers.get('content-type') || '';
    const isProblemJson = contentType4.includes('application/problem+json') || contentType4.includes('application/json');
    assert(
      isProblemJson,
      `Expected problem+json or json Content-Type, got "${contentType4}"`
    );

    const data4 = await res4.json();
    assert(
      data4 !== null && typeof data4 === 'object',
      `Expected JSON error response object`
    );
    if (data4.type || data4.title || data4.status || data4.detail) {
      console.log(`  ✓ INFO: RFC 9457 Problem Details fields present (type/title/status/detail)`);
    }
    console.log(`Response body preview:`, JSON.stringify(data4).slice(0, 150));

  } catch (err) {
    if (err.cause && (err.cause.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED')) {
      console.error(`\n ERROR: Could not connect to Prism server at ${CONFIG.baseUrl}`);
      console.error(`Make sure Prism is running: pnpm dlx @stoplight/prism-cli mock openapi.yaml -p 4010`);
    } else {
      console.error(`\n ERROR during contract test execution:`, err);
    }
    failed++;
  }

  // ----------------------------------------------------
  // Final Summary
  // ----------------------------------------------------
  console.log(`\n==================================================`);
  console.log(` TEST SUMMARY`);
  console.log(`==================================================`);
  console.log(` Total Passed: ${passed}`);
  console.log(` Total Failed: ${failed}`);
  console.log(` Result: ${failed === 0 ? 'SUCCESS' : 'FAILURE'}`);
  console.log(`==================================================\n`);

  process.exit(failed === 0 ? 0 : 1);
}

runTests();
