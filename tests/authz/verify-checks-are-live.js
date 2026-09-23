'use strict';

/**
 * Negative control for the object checks.
 *
 * A test that stays green when its check is removed tests nothing. This script
 * proves the four boundaries are really exercised by re-running the authz suite
 * with one ownership predicate neutralised at a time, and asserting the suite
 * goes RED each time.
 *
 * The service source is never edited: the predicate is neutralised through an
 * environment switch that only exists in the test harness. The service refuses
 * to honour it unless NODE_ENV === 'test', and the authz suite always sets
 * NODE_ENV=test, so production code paths are untouched.
 *
 * Run with:  node tests/authz/verify-checks-are-live.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { root } = require('../helpers/harness');

const CASES = [
  {
    label: 'test 1 — mayReadOrder (object read)',
    disable: 'mayReadOrder',
    expectRed: 'test 1: student-a reading student-b order -> 404',
  },
  {
    label: 'test 3 — requireScope (scope layer)',
    disable: 'requireScope',
    expectRed: 'test 3: student token on staff-only fulfilment -> 403',
  },
  {
    label: 'test 4 — staff outlet scoping',
    disable: 'staffOutlet',
    expectRed: 'test 4: staff-outlet-a reading outlet B order -> 404',
  },
  {
    label: 'test 2 — mayCollectPickup (object write)',
    disable: 'mayCollectPickup',
    expectRed: 'test 2: courier-a collecting courier-b pickup -> 404',
  },
];

function runAuthzSuite(disable) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'tests', 'authz', 'test-authz.js')],
      {
        cwd: root,
        env: {
          ...process.env,
          AUTHZ_DISABLE_CHECK: disable || '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('exit', (code) => resolve({ code: code ?? 1, output }));
  });
}

async function main() {
  const baseline = await runAuthzSuite(null);
  assert.equal(baseline.code, 0, 'baseline authz suite must pass with all checks enabled');
  console.log('PASS baseline: all four checks enabled -> suite green');

  for (const testCase of CASES) {
    const result = await runAuthzSuite(testCase.disable);
    const redForTheRightReason = result.output
      .split('\n')
      .some((line) => line.startsWith('FAIL') && line.includes(testCase.expectRed));
    assert.equal(
      result.code !== 0,
      true,
      `${testCase.label}: suite must fail when the check is disabled`,
    );
    assert.equal(
      redForTheRightReason,
      true,
      `${testCase.label}: expected the ${testCase.expectRed} check to be the one that fails`,
    );
    console.log(`PASS ${testCase.label}: disabled -> suite red for the expected reason`);
  }

  const restored = await runAuthzSuite(null);
  assert.equal(restored.code, 0, 'suite must be green again once checks are restored');
  console.log('PASS restored: all checks enabled -> suite green again');
  console.log('All four boundaries are proven to be genuinely exercised.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
