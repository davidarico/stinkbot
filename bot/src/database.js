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

/**
 * TLS for pg: Node can reject Supabase / pooler chains locally (SELF_SIGNED_CERT_IN_CHAIN)
 * while the same URL works on a server. Mirrors frontend `database.ts` heuristic + explicit override.
 */
function postgresSslOption() {
    const url = process.env.DATABASE_URL || '';
    const strict = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true';
    const relaxed = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false';
    const isProd = process.env.NODE_ENV === 'production';
    const looksLikeSupabase = /supabase\.co(m)?\b/i.test(url);

    if (strict) {
        return undefined;
    }
    if (relaxed) {
        console.warn('⚠️ Postgres TLS: DATABASE_SSL_REJECT_UNAUTHORIZED=false — certificate chain is not verified.');
        return { rejectUnauthorized: false };
    }
    if (!isProd && looksLikeSupabase) {
        console.warn(
            '⚠️ Postgres TLS (dev): Supabase URL detected — using relaxed SSL (rejectUnauthorized: false). ' +
                'Set DATABASE_SSL_REJECT_UNAUTHORIZED=true to enforce verification, or false to keep relaxed in production-like NODE_ENV.'
        );
        return { rejectUnauthorized: false };
    }
    return undefined;
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: postgresSslOption(),
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
