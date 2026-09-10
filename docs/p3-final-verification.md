# P3 Final Verification

## Local service

- Redocly lint: PASS, 0 errors, 4 warnings.
- Contract test: PASS, 33 assertions, 0 failures.
- Concurrent idempotency test: PASS, 5 concurrent requests, 1 unique order ID.
- Persistence/restart: verified in `service/EVIDENCE.md` after manual redeploy.
- Exact mappings: malformed ID `400`, missing key `400`, not found `404`, idempotency conflict `409`, domain validation `422`.
- Problem Details validation extension: `invalidFields` present.

## Deployment

Deployment URL: `https://pbse.kevinio.my.id`

Deployment re-test command:

```bash
BASE_URL="https://pbse.kevinio.my.id/v1" node tests/contract/test-contract.js
```

Result: 33 assertions passed, including `invalidFields`, after manual redeploy of service commit `350dbd2`.

## Final demo evidence

- Read: `service/EVIDENCE.md`
- Write then read: `service/EVIDENCE.md`
- Idempotent retry and restart persistence: `service/EVIDENCE.md`

## Documentation status

- Contract version: `0.2.1`.
- ADR: `docs/decisions/0002-implementasi.md`.
- Integration report: `docs/p3-integration-report.md`.
- Client review: `docs/p3-client-review.md`.
- Deployment test output: PASS, 33 assertions, service commit `350dbd2`.
