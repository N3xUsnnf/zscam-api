const { Pool } = require('pg');
require('dotenv').config();

const sslEnabled = process.env.DATABASE_SSL === 'true' || process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('✓ Conectado ao PostgreSQL');
});

module.exports = pool;
