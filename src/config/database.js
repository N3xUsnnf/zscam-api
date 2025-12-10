const { Pool } = require('pg');
require('dotenv').config();

let pool = null;

const getPool = () => {
  if (!pool) {
    const sslEnabled = process.env.DATABASE_SSL === 'true' || process.env.NODE_ENV === 'production';
    
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL não configurado');
    }

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      max: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('connect', () => {
      console.log('✓ Conectado ao PostgreSQL');
    });

    pool.on('error', (err) => {
      console.error('❌ Erro no pool de conexão:', err);
    });
  }

  return pool;
};

module.exports = { getPool };
