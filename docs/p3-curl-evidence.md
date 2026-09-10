# P3 Curl Evidence

**Date:** 2026-09-09 (historical evidence)
**Commit tested:** `50a53da` (historical evidence)

> Final local verification is recorded in `p3-final-verification.md`. Re-run deployment curl scenarios after final image redeploy and replace this header with final commit hash.

## Prism Mock

Command target:

```bash
BASE_URL=http://127.0.0.1:4010 bash tests/contract/curl-scenarios.sh
```

Result at tested commit: GET collection 200, GET filter 200, POST with `Idempotency-Key` 201, and POST without the key 422 with `application/problem+json`. Prism is static and may not match service-side validation branches exactly.

Raw output: [p3-curl-evidence-prism.txt](p3-curl-evidence-prism.txt)

## Live Service

Command target:

```bash
BASE_URL=http://127.0.0.1:8080/v1 \
ENDPOINT_COLLECTION=/orders \
ENDPOINT_CREATE=/orders \
bash tests/contract/curl-scenarios.sh
```

Result at tested commit: GET collection 200, GET filter 200, POST with `Idempotency-Key` 201 with `Location`, and POST without the key 400 with `application/problem+json`.

Raw output: [p3-curl-evidence-service.txt](p3-curl-evidence-service.txt)
