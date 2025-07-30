const { Pool } = require('pg');

if (process.env.NODE_ENV !== 'production') {
    console.log('🔧 Loading environment variables from .env file');
    require('dotenv').config();
}

// Use connection string format for better Supabase compatibility
const connectionString = process.env.DATABASE_URL || 
    `postgresql://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT || 6543}/${process.env.PG_DATABASE}?sslmode=require`;

const pool = new Pool({
    connectionString: connectionString,
    // Add connection pooling settings for Supabase
    max: 20, // Maximum connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    // SSL configuration (redundant with sslmode=require in connection string, but kept for compatibility)
    ssl: {
        rejectUnauthorized: false
    }
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
