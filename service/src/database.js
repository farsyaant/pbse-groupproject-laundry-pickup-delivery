'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const serviceRoot = path.resolve(__dirname, '..');
const dbPath = path.resolve(serviceRoot, config.DATABASE_FILE);
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaSQL = fs.readFileSync(
  path.resolve(serviceRoot, 'db', 'schema.sql'),
  'utf8',
);

/**
 * Migrate a pre-P4 database in place.
 *
 * `CREATE TABLE IF NOT EXISTS` never widens an existing table, so a database
 * created by P3 keeps its old `orders` shape. Dropping and recreating it would
 * destroy data, so the P4 column is added with ALTER TABLE instead.
 *
 * This must run *before* schema.sql: the P4 schema creates an index on
 * `orders.outlet_id`, and on a P3 database that column does not exist yet.
 * On a brand-new database `orders` does not exist at all, so this is a no-op
 * and schema.sql creates the table with the column already present.
 */
function migrate() {
  const ordersExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'orders'",
    )
    .get();
  if (!ordersExists) return;

  const columns = db.pragma('table_info(orders)').map((column) => column.name);
  if (!columns.includes('outlet_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN outlet_id TEXT');
  }
}

migrate();
db.exec(schemaSQL);

module.exports = db;
