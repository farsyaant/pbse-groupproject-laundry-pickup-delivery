/**
 * Contract Testing Suite for Role B (Integration Owner - Faris) - P3
 * 
 * Supports seamless switching between Prism Mock Server and Live Service.
 * 
 * Usage:
 *   # Run against Prism Mock (Default port 4010)
 *   BASE_URL="http://127.0.0.1:4010" node tests/contract/test-contract.js
 * 
 *   # Run against Live Service (Default port 8080)
 *   BASE_URL="http://127.0.0.1:8080/v1" node tests/contract/test-contract.js
 */

const crypto = require('crypto');

// Determine base URL from environment or default to Prism mock
const RAW_BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4010';
// Strip trailing slash if any
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');

const CONFIG = {
  baseUrl: BASE_URL,
    isLiveService: BASE_URL.includes(':8080') || BASE_URL.includes('pbse.kevinio.my.id') || process.env.IS_LIVE === 'true',
  endpoints: {
    collection: process.env.ENDPOINT_COLLECTION || '/orders',
    filterParam: process.env.ENDPOINT_FILTER || 'status=pending_pickup',
    createOrder: process.env.ENDPOINT_CREATE || '/orders',
  },
  samplePayload: {
    customerId: 'cus_01HZX2Y1AB',
    serviceType: 'wash_fold',
    weightKg: 5.5,
    pickupAddress: 'Jl. Merdeka No. 10, Jakarta',
  },
};

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
  console.log(`Target Type: ${CONFIG.isLiveService ? 'Live Service' : 'Prism Mock'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    // ----------------------------------------------------
    // Skenario 1: GET Collection
    // ----------------------------------------------------
    logHeader('Skenario 1: GET Collection (Status 200 & valid JSON array/collection)');
    const urlCollection = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}`;
    console.log(`Request: GET ${urlCollection}`);

    const res1 = await fetch(urlCollection, {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer mock_token',
      },
    });

    assert(res1.status === 200, `Expected status 200, got ${res1.status}`);
    const contentType1 = res1.headers.get('content-type') || '';
    assert(contentType1.includes('application/json'), `Expected Content-Type application/json, got "${contentType1}"`);

    const data1 = await res1.json();
    assert(Array.isArray(data1) || (typeof data1 === 'object' && data1 !== null), `Expected JSON array or object collection`);
    console.log(`Response preview:`, JSON.stringify(data1).slice(0, 150));

    // ----------------------------------------------------
    // Skenario 2: GET with Filter
    // ----------------------------------------------------
    logHeader(`Skenario 2: GET with Filter (${CONFIG.endpoints.filterParam})`);
    const urlFilter = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}?${CONFIG.endpoints.filterParam}`;
    console.log(`Request: GET ${urlFilter}`);

    const res2 = await fetch(urlFilter, {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer mock_token',
      },
    });

    assert(res2.status === 200, `Expected status 200, got ${res2.status}`);
    const data2 = await res2.json();
    assert(data2 !== null && typeof data2 === 'object', `Expected valid JSON response for filtered request`);
    console.log(`Response preview:`, JSON.stringify(data2).slice(0, 150));

    // ----------------------------------------------------
    // Skenario 3: POST unsafe WITH Idempotency-Key & Location Header
    // ----------------------------------------------------
    logHeader('Skenario 3: POST unsafe WITH Idempotency-Key (Status 201 Created & Location Header)');
    const urlPost = `${CONFIG.baseUrl}${CONFIG.endpoints.createOrder}`;
    const idempotencyKey = crypto.randomUUID();
    console.log(`Request: POST ${urlPost}`);
    console.log(`Header Idempotency-Key: ${idempotencyKey}`);

    const res3 = await fetch(urlPost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer mock_token',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(CONFIG.samplePayload),
    });

    assert(res3.status === 201, `Expected status 201, got ${res3.status}`);
    
    if (CONFIG.isLiveService && res3.status === 201) {
      const locationHeader = res3.headers.get('location');
      assert(locationHeader !== null, `Expected Location header in 201 response, got "${locationHeader}"`);
    }

    const data3 = await res3.json();
    assert(data3 !== null && typeof data3 === 'object' && data3.id, `Expected returned Order object with 'id' field`);
    console.log(`Created Order ID:`, data3.id);

    // Save order ID for GET single test
    const createdOrderId = data3.id;

    // ----------------------------------------------------
    // Skenario 4: GET Single Order by ID
    // ----------------------------------------------------
    if (createdOrderId) {
      logHeader(`Skenario 4: GET Single Order (${createdOrderId})`);
      const urlSingle = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}/${createdOrderId}`;
      console.log(`Request: GET ${urlSingle}`);

      const resSingle = await fetch(urlSingle, {
        headers: { Accept: 'application/json', Authorization: 'Bearer mock_token' },
      });

      assert(resSingle.status === 200, `Expected status 200, got ${resSingle.status}`);
      const dataSingle = await resSingle.json();
      assert(dataSingle.id === createdOrderId, `Expected order id '${createdOrderId}', got '${dataSingle.id}'`);
    }

    // ----------------------------------------------------
    // Skenario 5: Server-side Idempotency Re-execution (Same Key + Same Body)
    // ----------------------------------------------------
    logHeader('Skenario 5: Idempotent Retry (Same Key + Same Body -> Same 201/200 Response)');
    console.log(`Re-sending POST ${urlPost} with same key (${idempotencyKey})`);

    const resIdemSame = await fetch(urlPost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer mock_token',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(CONFIG.samplePayload),
    });

    assert(resIdemSame.status === 201, `Expected status 201 on retry, got ${resIdemSame.status}`);
    const dataIdemSame = await resIdemSame.json();
    assert(dataIdemSame.id === createdOrderId, `Expected same entity ID '${createdOrderId}', got '${dataIdemSame.id}'`);

    // ----------------------------------------------------
    // Skenario 6: Idempotency Conflict (Same Key + Different Body)
    // ----------------------------------------------------
    logHeader('Skenario 6: Idempotency Conflict (Same Key + Different Body -> 409 Conflict)');
    const diffPayload = { ...CONFIG.samplePayload, weightKg: 9.9 };

    const resIdemDiff = await fetch(urlPost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/problem+json',
        'Authorization': 'Bearer mock_token',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(diffPayload),
    });

    if (CONFIG.isLiveService) {
      assert(resIdemDiff.status === 409, `Expected status 409 Conflict for different body, got ${resIdemDiff.status}`);
    } else {
      console.log(`  ✓ INFO: Prism mock skipped 409 diff body check (Prism is static)`);
    }

    // ----------------------------------------------------
    // Skenario 7: POST unsafe WITHOUT Idempotency-Key
    // ----------------------------------------------------
    logHeader('Skenario 7: POST unsafe WITHOUT Idempotency-Key (RFC 9457 Problem Details)');
    console.log(`Request: POST ${urlPost} (No Idempotency-Key)`);

    const res7 = await fetch(urlPost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/problem+json',
        'Authorization': 'Bearer mock_token',
      },
      body: JSON.stringify(CONFIG.samplePayload),
    });

    assert(res7.status === 400, `Expected rejection status 400, got ${res7.status}`);
    const contentType7 = res7.headers.get('content-type') || '';
    assert(contentType7.includes('application/problem+json'), `Expected Content-Type application/problem+json, got "${contentType7}"`);

    const data7 = await res7.json();
    assert(typeof data7.type === 'string', `Error has 'type' field`);
    assert(typeof data7.title === 'string', `Error has 'title' field`);
    assert(typeof data7.status === 'number', `Error has 'status' field`);
    assert(typeof data7.detail === 'string', `Error has 'detail' field`);
    assert(typeof data7.instance === 'string', `Error has 'instance' field`);

    // ----------------------------------------------------
    // Skenario 8: Negative Test - GET Malformed & Not Found Order ID
    // ----------------------------------------------------
    logHeader('Skenario 8: Negative Tests (Malformed ID -> 400, Non-existent ID -> 404)');
    const urlMalformed = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}/invalid!id!format`;
    const resMalformed = await fetch(urlMalformed, {
      headers: { Accept: 'application/json', Authorization: 'Bearer mock_token' },
    });
    assert(resMalformed.status === 400, `Expected 400 for malformed ID, got ${resMalformed.status}`);

    const urlNotFound = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}/ord_0000000000`;
    const resNotFound = await fetch(urlNotFound, {
      headers: { Accept: 'application/json, application/problem+json', Authorization: 'Bearer mock_token', Prefer: 'code=404' },
    });
    assert(resNotFound.status === 404, `Expected status 404 Not Found, got ${resNotFound.status}`);

    // ----------------------------------------------------
    // Skenario 9: GET Collection — Pagination (limit param)
    // ----------------------------------------------------
    logHeader('Skenario 9: GET Collection Pagination (limit=1)');
    const urlPagination = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}?limit=1`;
    console.log(`Request: GET ${urlPagination}`);

    const resPagination = await fetch(urlPagination, {
      headers: { Accept: 'application/json', Authorization: 'Bearer mock_token' },
    });

    assert(resPagination.status === 200, `Expected status 200, got ${resPagination.status}`);
    const dataPagination = await resPagination.json();
    assert(
      Array.isArray(dataPagination) && dataPagination.length <= 1,
      `Expected paginated array with at most 1 item, got ${Array.isArray(dataPagination) ? dataPagination.length : typeof dataPagination} items`
    );

    // ----------------------------------------------------
    // Skenario 10: GET Collection — Empty Collection (status with no live rows)
    // ----------------------------------------------------
    logHeader('Skenario 10: GET Collection Empty Result (status=completed)');
    const urlEmpty = `${CONFIG.baseUrl}${CONFIG.endpoints.collection}?status=completed`;
    console.log(`Request: GET ${urlEmpty}`);

    const resEmpty = await fetch(urlEmpty, {
      headers: { Accept: 'application/json', Authorization: 'Bearer mock_token' },
    });

    assert(resEmpty.status === 200, `Expected status 200 for empty collection, got ${resEmpty.status}`);
    const dataEmpty = await resEmpty.json();
    assert(Array.isArray(dataEmpty), `Expected JSON array for empty collection, got ${typeof dataEmpty}`);
    if (CONFIG.isLiveService) {
      assert(dataEmpty.length === 0, `Expected empty JSON array, got ${dataEmpty.length} items`);
    } else {
      console.log(`  ✓ INFO: Prism static mock returned ${dataEmpty.length} example item(s); empty filtering is validated by live service`);
    }

    // ----------------------------------------------------
    // Skenario 11: POST — Invalid body (missing required field) -> 400
    // ----------------------------------------------------
    logHeader('Skenario 11: POST invalid body (missing required fields -> 400)');
    const invalidPayload = { customerId: 'cus_123' };
    const resInvalid = await fetch(urlPost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/problem+json',
        'Authorization': 'Bearer mock_token',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(invalidPayload),
    });

    assert(resInvalid.status === 400, `Expected 400 for invalid body, got ${resInvalid.status}`);
    const ctInvalid = resInvalid.headers.get('content-type') || '';
    assert(ctInvalid.includes('problem+json'), `Expected problem+json, got "${ctInvalid}"`);
    const invalidData = await resInvalid.json();
    assert(Array.isArray(invalidData.invalidFields), `Invalid body error has 'invalidFields' field`);

    // ----------------------------------------------------
    // Skenario 12: POST — Domain-invalid body -> 422
    // ----------------------------------------------------
    logHeader('Skenario 12: POST domain-invalid body (422 Unprocessable Content)');
    const domainInvalidPayload = { ...CONFIG.samplePayload, customerId: 'invalid_customer' };
    const resDomainInvalid = await fetch(urlPost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/problem+json',
        'Authorization': 'Bearer mock_token',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(domainInvalidPayload),
    });

    assert(resDomainInvalid.status === 422, `Expected 422 for domain-invalid body, got ${resDomainInvalid.status}`);
    const ctDomainInvalid = resDomainInvalid.headers.get('content-type') || '';
    assert(ctDomainInvalid.includes('problem+json'), `Expected problem+json, got "${ctDomainInvalid}"`);
    const domainInvalidData = await resDomainInvalid.json();
    assert(Array.isArray(domainInvalidData.invalidFields), `Domain validation error has 'invalidFields' field`);

  } catch (err) {
    if (err.cause && (err.cause.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED')) {
      console.error(`\n ERROR: Could not connect to target server at ${CONFIG.baseUrl}`);
      console.error(`Make sure Prism (port 4010) or Service (port 8080) is running.`);
    } else {
      console.error(`\n ERROR during contract test execution:`, err);
    }
    failed++;
  }

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
