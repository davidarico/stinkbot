const { Pool } = require('pg');

if (process.env.NODE_ENV !== 'production') {
    console.log('🔧 Loading environment variables from .env file');
    require('dotenv').config();
}

// Validate required environment variable
if (!process.env.DATABASE_URL) {
    throw new Error('Missing required DATABASE_URL environment variable');
}

console.log('🔗 Using connection string for Supabase');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Connection pooling settings for Supabase
    max: 20, // Maximum connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
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
