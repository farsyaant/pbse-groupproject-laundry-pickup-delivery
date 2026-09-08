'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const REQUIRED = ['PORT', 'DATABASE_FILE'];

for (const key of REQUIRED) {
  if (!process.env[key] || process.env[key].trim() === '') {
    console.error(`FATAL  Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const port = parseInt(process.env.PORT, 10);
if (Number.isNaN(port) || port < 1 || port > 65535) {
  console.error('FATAL  PORT must be a valid port number (1-65535)');
  process.exit(1);
}

module.exports = Object.freeze({
  PORT: port,
  DATABASE_FILE: process.env.DATABASE_FILE,
  NODE_ENV: process.env.NODE_ENV || 'development',
});
