const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// In this monorepo, `cwd` differs depending on whether you run migrations (`cd database`) or the bot (repo root).
// To avoid loading different DATABASE_URL values, prefer `database/.env` when present.
if (process.env.NODE_ENV !== 'production') {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const envCandidates = [
        path.join(repoRoot, 'database', '.env'),
        path.join(repoRoot, '.env'),
        path.join(repoRoot, 'bot', '.env'),
    ];

    const envPath = envCandidates.find((p) => fs.existsSync(p));
    if (envPath) {
        console.log(`🔧 Loading environment variables from ${envPath}`);
        require('dotenv').config({ path: envPath });
    } else {
        console.log('🔧 No .env file found (checked database/.env, .env, bot/.env)');
    }
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
    // Supabase/hosted Postgres can take a few seconds to accept new connections, especially from sleep.
    connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || '10000', 10),
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
