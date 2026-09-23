'use strict';

// One-off diagnostic: build a P3-shaped database and confirm P4 migrates it in
// place without losing rows.
const path = require('node:path');

const serviceDir = path.resolve(__dirname, '..', '..', 'service');
const Database = require(path.join(serviceDir, 'node_modules', 'better-sqlite3'));
const fs = require('node:fs');
const os = require('node:os');

const file = path.join(os.tmpdir(), `p3-legacy-${Date.now()}.sqlite`);
const legacy = new Database(file);
legacy.exec(`
CREATE TABLE orders (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, service_type TEXT NOT NULL,
  weight_kg REAL NOT NULL, pickup_address TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE cancellations (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', created_at TEXT NOT NULL
);
CREATE TABLE idempotency_records (
  key TEXT PRIMARY KEY, body_hash TEXT NOT NULL, request_status TEXT NOT NULL,
  response_status INTEGER, response_body TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
INSERT INTO orders VALUES ('ord_p3legacy','cus_p3','wash_fold',5.5,'Jl. P3 No. 1','pending_pickup','2026-01-01T10:00:00.000Z','2026-01-01T10:00:00.000Z');
`);
legacy.close();

process.env.DATABASE_FILE = file;
process.env.PORT = '1';
process.env.OIDC_ISSUER = 'http://127.0.0.1:9/test-issuer';
process.env.OIDC_JWKS_URI = 'http://127.0.0.1:9/jwks';
process.env.OIDC_AUDIENCE = 'laundry-api-test';

require(path.join(serviceDir, 'src', 'database.js'));

const after = new Database(file, { readonly: true });
console.log('orders columns:', after.pragma('table_info(orders)').map((c) => c.name).join(','));
console.log('tables:', after.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name).join(','));
console.log('legacy row preserved:', JSON.stringify(after.prepare('SELECT id, outlet_id FROM orders WHERE id = ?').get('ord_p3legacy')));
after.close();

for (const suffix of ['', '-wal', '-shm']) {
  // The service's database module still holds its handle open, so on Windows
  // the temp file cannot always be removed; that is not a migration failure.
  try {
    fs.rmSync(`${file}${suffix}`, { force: true });
  } catch {
    // Left behind in the OS temp directory.
  }
}
