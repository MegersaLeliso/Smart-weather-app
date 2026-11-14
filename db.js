/**
 * db.js
 * Creates a shared PostgreSQL connection pool using credentials from .env.
 * Import this pool anywhere you need to query the database:
 *   const pool = require('./db');
 *   const { rows } = await pool.query('SELECT NOW()');
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE,
});

// Log errors from idle clients instead of letting them crash the process
pool.on('error', (err) => {
  console.error('[DB ERROR] Unexpected error on idle client:', err.message);
});

module.exports = pool;
