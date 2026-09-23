'use strict';

/**
 * Test-only fault injection, loaded with `node --require`.
 *
 * The assignment asks for proof that each negative test actually fails when its
 * check is removed ("a test that stays green when its check is deleted tests
 * nothing"). That proof must not require editing the service, and must never
 * introduce a bypass path into production code.
 *
 * So the neutralisation happens here, entirely outside the service: this module
 * intercepts the service's own modules as they are loaded and replaces the
 * predicate named by AUTHZ_DISABLE_CHECK with a permissive one.
 *
 * The hook is only ever installed by tests/authz/verify-checks-are-live.js,
 * which sets AUTHZ_DISABLE_CHECK. Without that variable this module does
 * nothing at all.
 */

const Module = require('node:module');
const path = require('node:path');

const target = process.env.AUTHZ_DISABLE_CHECK;
if (target) {
  const serviceSrc = path.resolve(__dirname, '..', '..', 'service', 'src');
  const ownershipPath = path.join(serviceSrc, 'auth', 'ownership.js');
  const scopePath = path.join(serviceSrc, 'auth', 'require-scope.js');

  const patch = (loadedModule) => {
    switch (target) {
      case 'mayReadOrder':
        loadedModule.mayReadOrder = () => true;
        break;
      case 'mayCollectPickup':
        loadedModule.mayCollectPickup = () => true;
        break;
      case 'staffOutlet':
        // `mayReadOrder` calls `isStaffOfOutlet` as a module-local function, so
        // replacing the export alone would not affect it. Instead, drop exactly
        // the outlet dimension: make every order look like it belongs to the
        // caller's outlet, leaving customer and driver rules untouched.
        {
          const base = loadedModule.mayReadOrder;
          loadedModule.mayReadOrder = (principal, order, assignment) =>
            base(
              principal,
              { ...order, outlet_id: principal?.outletId ?? order.outlet_id },
              assignment,
            );
        }
        break;
      case 'requireScope':
        loadedModule.requireScope = () => (_req, _res, next) => next();
        break;
      default:
        throw new Error(`Unknown AUTHZ_DISABLE_CHECK target: ${target}`);
    }
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const loaded = originalLoad.call(this, request, parent, isMain);
    try {
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (resolved === ownershipPath || resolved === scopePath) patch(loaded);
    } catch {
      // Resolution failure is the service's problem, not the hook's.
    }
    return loaded;
  };

  console.log(`[test-hook] authorization check disabled for this run: ${target}`);
}
