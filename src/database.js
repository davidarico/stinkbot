const { Pool } = require('pg');

if (process.env.NODE_ENV !== 'production') {
    console.log('🔧 Loading environment variables from .env file');
    require('dotenv').config();
}

const pool = new Pool({
    host: process.env.PG_HOST, // Build for a Supabase transaction pooler host
    port: process.env.PG_PORT || 6543, // Transaction pooler port
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    // Add connection pooling settings for Supabase
    max: 20, // Maximum connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    options: process.env.PG_SCHEMA ? `-c search_path=${process.env.PG_SCHEMA},public` : undefined,
});

// Test the connection
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

// If using custom schema, set search path for all connections
if (process.env.PG_SCHEMA) {
    pool.on('connect', async (client) => {
        try {
            await client.query(`SET search_path TO ${process.env.PG_SCHEMA}, public`);
        } catch (error) {
            console.error('❌ Error setting search path:', error);
        }
    });
}

pool.on('error', (err) => {
    console.error('❌ PostgreSQL connection error:', err);
});

module.exports = pool;
