'use strict';

/**
 * P4 authorization tests — four negative tests, each crossing a different
 * boundary, plus the Layer 1 checks the assignment asks for.
 *
 *   #  Boundary crossed                                       Expected  Layer
 *   1  student-a reads an order owned by student-b             404       object
 *   2  courier-a collects a pickup assigned to courier-b       404       object (write)
 *   3  student calls a staff-only operation                    403       scope
 *   4  staff of outlet A reads an order of outlet B            404       object
 *
 * Run with:  node tests/authz/test-authz.js   (or `pnpm --dir service run test:authz`)
 *
 * Tokens come from a test-only signing key, so CI needs no network access to a
 * live authorization server. The verifier is exercised in full: signature,
 * algorithm, issuer, audience, and expiry are all checked, and no bypass path
 * exists for tests.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const {
  FIXTURES,
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

const issuerPort = freePort(0);
const servicePort = freePort(1);
const databaseFile = tempDatabaseFile('authz');

const results = [];
let failures = 0;

function check(condition, label) {
  if (condition) {
    results.push(`PASS ${label}`);
    return;
  }
  failures += 1;
  results.push(`FAIL ${label}`);
}

function idempotencyKey() {
  return crypto.randomUUID();
}

async function main() {
  const issuer = await startTestIssuer({ port: issuerPort });
  const base = `http://127.0.0.1:${servicePort}`;

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

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  let db = null;

  // Every token minted for this run is recorded so the log scan can assert
  // that none of them ever reached the service output.
  const issuedTokens = [];
  async function tok(subject, overrides) {
    const value = await issuer.token(subject, overrides);
    issuedTokens.push(value);
    return value;
  }

  async function get(pathname, token) {
    return fetch(`${base}${pathname}`, token ? { headers: auth(token) } : undefined);
  }

  async function post(pathname, token, body, key) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (key) headers['Idempotency-Key'] = key;
    return fetch(`${base}${pathname}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  try {
    await waitForHealth(servicePort, () => serviceOutput);

    const readA = await tok('student-a', { scopes: ['orders:read'] });
    const writeA = await tok('student-a', { scopes: ['orders:write'] });
    const writeB = await tok('student-b', { scopes: ['orders:write'] });
    const courierA = await tok('courier-a');
    const courierB = await tok('courier-b');
    const staffA = await tok('staff-outlet-a');
    const staffB = await tok('staff-outlet-b');
    const staffARead = await tok('staff-outlet-a', { scopes: ['orders:read'] });

    // Opened only once the service has created its schema. Read-only: this
    // handle exists to prove a refused write left no trace.
    db = new Database(databaseFile, { readonly: true });

    // ---------------------------------------------------------------------
    // Layer 1 — authentication
    // ---------------------------------------------------------------------
    check((await fetch(`${base}/health`)).status === 200, '/health stays public without a token');

    const noToken = await get('/v1/orders');
    check(noToken.status === 401, 'no Authorization header on a protected route -> 401');
    check(
      (noToken.headers.get('www-authenticate') || '').includes('invalid_token'),
      '401 carries WWW-Authenticate: invalid_token',
    );

    const badScheme = await fetch(`${base}/v1/orders`, { headers: { Authorization: 'Basic abc' } });
    check(badScheme.status === 401, 'non-Bearer Authorization scheme -> 401');

    const edited = issuer.editPayload(readA, { sub: 'attacker', fixture_domain_id: 'cus_attacker', scope: 'orders:read' });
    check((await get('/v1/orders', edited)).status === 401, 'token with an edited payload -> 401');

    const expired = await tok('student-a', { expiresIn: '-10s' });
    check((await get('/v1/orders', expired)).status === 401, 'expired token -> 401');

    const wrongIssuer = await tok('student-a', { issuer: 'http://127.0.0.1:9/other' });
    check((await get('/v1/orders', wrongIssuer)).status === 401, 'token from a different issuer -> 401');

    const wrongAudience = await tok('student-a', { audience: 'some-other-api' });
    check((await get('/v1/orders', wrongAudience)).status === 401, 'token for a different audience -> 401');

    const foreignKey = await startTestIssuer({ port: freePort(5) });
    const wrongSignature = await foreignKey.token('student-a');
    await foreignKey.close();
    check((await get('/v1/orders', wrongSignature)).status === 401, 'token signed by an unknown key -> 401');

    // ---------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------
    const orderPayloadB = {
      customerId: 'cus_studentB',
      serviceType: 'wash_fold',
      weightKg: 3.5,
      pickupAddress: 'Jl. Student B No. 2, Jakarta',
    };
    const createdB = await post('/v1/orders', writeB, orderPayloadB, idempotencyKey());
    assert.equal(createdB.status, 201, 'fixture: student-b order created');
    const orderB = await createdB.json();

    const orderPayloadA = {
      customerId: 'cus_studentA',
      serviceType: 'dry_clean',
      weightKg: 2,
      pickupAddress: 'Jl. Student A No. 1, Jakarta',
    };
    const createdA = await post('/v1/orders', writeA, orderPayloadA, idempotencyKey());
    assert.equal(createdA.status, 201, 'fixture: student-a order created');
    const orderA = await createdA.json();

    // ---------------------------------------------------------------------
    // Test 1 — a student cannot read another student's order (object layer)
    // ---------------------------------------------------------------------
    const foreignOrder = await get(`/v1/orders/${orderB.id}`, readA);
    const absentOrder = await get('/v1/orders/ord_doesnotexist', readA);
    check(foreignOrder.status === 404, 'test 1: student-a reading student-b order -> 404 (not 403)');
    check(absentOrder.status === 404, 'test 1: unknown order -> 404');
    const foreignOrderBody = await foreignOrder.json();
    const absentOrderBody = await absentOrder.json();
    check(
      JSON.stringify(foreignOrderBody) === JSON.stringify(absentOrderBody),
      'test 1: absent and not-owned 404 bodies are identical',
    );
    check(!('customerId' in foreignOrderBody), 'test 1: the 404 body leaks no order fields');

    const ownOrder = await get(`/v1/orders/${orderA.id}`, readA);
    check(ownOrder.status === 200, 'test 1 control: student-a reads their own order -> 200');

    // ---------------------------------------------------------------------
    // Test 3 — a student calling a staff-only operation (scope layer)
    // ---------------------------------------------------------------------
    const staffOnlyById = await post(`/v1/orders/${orderA.id}/fulfilment`, readA);
    check(staffOnlyById.status === 403, 'test 3: student token on staff-only fulfilment -> 403');

    const staffOnlyUnknownId = await post('/v1/orders/ord_doesnotexist/fulfilment', readA);
    check(
      staffOnlyUnknownId.status === 403,
      'test 3: scope is refused before the object is loaded (unknown id still 403)',
    );

    const staffOnlyDispatch = await post('/v1/pickups', readA, {
      orderId: orderA.id,
      driverId: 'drv_courierA',
      scheduledAt: new Date().toISOString(),
    }, idempotencyKey());
    check(staffOnlyDispatch.status === 403, 'test 3: student token on pickup dispatch -> 403');

    const forbiddenBody = await staffOnlyById.json();
    check(
      Array.isArray(forbiddenBody.requiredScopes) && forbiddenBody.requiredScopes.includes('orders:fulfil'),
      'test 3: 403 names the missing scope',
    );

    // ---------------------------------------------------------------------
    // Test 4 — staff of outlet A cannot read an order of outlet B
    // ---------------------------------------------------------------------
    const claimedByB = await post(`/v1/orders/${orderB.id}/fulfilment`, staffB);
    check(claimedByB.status === 200, 'fixture: staff-outlet-b takes student-b order into outlet B');
    const claimedByBBody = await claimedByB.json();
    check(claimedByBBody.outletId === 'outlet_b', 'fixture: order is bound to outlet_b');

    const foreignOutletOrder = await get(`/v1/orders/${orderB.id}`, staffA);
    const absentForStaff = await get('/v1/orders/ord_doesnotexist', staffA);
    check(foreignOutletOrder.status === 404, 'test 4: staff-outlet-a reading outlet B order -> 404');
    check(
      JSON.stringify(await foreignOutletOrder.json()) === JSON.stringify(await absentForStaff.json()),
      'test 4: absent and other-outlet 404 bodies are identical',
    );

    const ownOutletOrder = await get(`/v1/orders/${orderB.id}`, staffB);
    check(ownOutletOrder.status === 200, 'test 4 control: staff-outlet-b reads its own outlet order -> 200');

    const staffAList = await (await get('/v1/orders', staffARead)).json();
    check(
      Array.isArray(staffAList) && !staffAList.some((order) => order.id === orderB.id),
      'test 4: collection is filtered in the query, outlet B order absent from outlet A list',
    );
    const staffBList = await (await get('/v1/orders', staffB)).json();
    check(
      staffBList.some((order) => order.id === orderB.id),
      'test 4 control: outlet B list contains its own order',
    );

    // ---------------------------------------------------------------------
    // Test 2 — a courier cannot collect another courier's pickup (write)
    // ---------------------------------------------------------------------
    const dispatch = await post('/v1/pickups', staffA, {
      orderId: orderA.id,
      driverId: FIXTURES['courier-b'].domainId,
      scheduledAt: '2026-09-03T09:00:00Z',
    }, idempotencyKey());
    assert.equal(dispatch.status, 201, 'fixture: staff-outlet-a dispatches pickup to courier-b');
    const pickup = await dispatch.json();
    check(pickup.driverId === 'drv_courierB', 'fixture: pickup is assigned to courier-b');

    const readPickupState = () =>
      db.prepare('SELECT status, collected_at FROM pickups WHERE id = ?').get(pickup.id);

    const beforeCollect = readPickupState();

    const collectByA = await post(`/v1/pickups/${pickup.id}/collect`, courierA);
    const collectAbsent = await post('/v1/pickups/pku_doesnotexist/collect', courierA);
    check(collectByA.status === 404, 'test 2: courier-a collecting courier-b pickup -> 404');
    check(collectAbsent.status === 404, 'test 2: unknown pickup -> 404');
    check(
      JSON.stringify(await collectByA.json()) === JSON.stringify(await collectAbsent.json()),
      'test 2: absent and not-owned 404 bodies are identical',
    );

    const afterCollect = readPickupState();
    check(
      afterCollect.status === beforeCollect.status && afterCollect.collected_at === beforeCollect.collected_at,
      'test 2: the refused write did not change the database row',
    );
    check(afterCollect.status === 'assigned', 'test 2: pickup is still assigned after the refused collect');

    const collectByB = await post(`/v1/pickups/${pickup.id}/collect`, courierB);
    check(collectByB.status === 200, 'test 2 control: courier-b collects their own pickup -> 200');
    const collectedBody = await collectByB.json();
    check(collectedBody.status === 'picked_up', 'test 2 control: pickup is now picked_up');
    check(readPickupState().status === 'picked_up', 'test 2 control: the database row was written');

    // Collection scoping for drivers, applied in the query.
    const courierAList = await (await get('/v1/pickups', courierA)).json();
    check(
      Array.isArray(courierAList) && !courierAList.some((item) => item.id === pickup.id),
      'test 2: courier-a list does not contain courier-b pickup',
    );
    const courierBList = await (await get('/v1/pickups', courierB)).json();
    check(
      courierBList.some((item) => item.id === pickup.id),
      'test 2 control: courier-b list contains their own pickup',
    );

    // ---------------------------------------------------------------------
    // Additional checks from the Integration Owner's commit 03f7cb1
    // ("add expired token and no mutation checks", branch integration-owner).
    // Folded in here so they also cover the P4 endpoints, instead of existing
    // only on that branch.
    // ---------------------------------------------------------------------

    // An unauthorized write must not mutate the object. Compare the whole
    // representation before and after, not just the status code: a handler that
    // mutates and then answers 404 would pass a status-only check.
    const beforeCancel = await (await get(`/v1/orders/${orderB.id}`, writeB)).json();
    const cancelAttempt = await post(
      `/v1/orders/${orderB.id}/cancellation`,
      writeA,
      undefined,
      idempotencyKey(),
    );
    check(cancelAttempt.status === 404, 'student-a cancelling student-b order -> 404');
    const afterCancel = await (await get(`/v1/orders/${orderB.id}`, writeB)).json();
    check(
      JSON.stringify(beforeCancel) === JSON.stringify(afterCancel),
      'the refused cancellation left the order byte-identical (ownership checked before mutation)',
    );

    // No error response body may echo back the token that was presented.
    const forbiddenBodyText = await (
      await post(`/v1/orders/${orderA.id}/fulfilment`, readA)
    ).text();
    const notFoundBodyText = await (await get(`/v1/orders/${orderB.id}`, readA)).text();
    const rejectedBodyText = await (await get('/v1/orders', edited)).text();
    check(
      ![forbiddenBodyText, notFoundBodyText, rejectedBodyText].some(
        (body) => body.includes(readA) || body.includes(edited),
      ),
      'no error response body echoes the presented token',
    );

    // ---------------------------------------------------------------------
    // Step 9 — no token may reach the logs
    // ---------------------------------------------------------------------
    const leakedTokens = issuedTokens.filter((value) => serviceOutput.includes(value));
    const jwtShaped = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/.test(serviceOutput);
    const authorizationLeak = /authorization"?\s*[:=]\s*"?\s*Bearer\s+[A-Za-z0-9_.-]{20,}/i.test(serviceOutput);
    const logScan = leakedTokens.length > 0 || jwtShaped || authorizationLeak;
    check(!logScan, 'service output contains no issued token, no JWT, and no Authorization header');

    if (logScan) {
      console.error('--- service output (token leak detected) ---');
      console.error(serviceOutput);
    }
  } finally {
    try { db?.close(); } catch { /* already closed */ }
    await stopChild(service);
    await issuer.close();
    removeDatabase(databaseFile);
  }

  for (const line of results) console.log(line);
  if (failures > 0) {
    console.error(`Authz tests failed: ${failures} check(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('Authz tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
