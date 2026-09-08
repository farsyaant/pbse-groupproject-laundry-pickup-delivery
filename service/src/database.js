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
db.exec(schemaSQL);

module.exports = db;
