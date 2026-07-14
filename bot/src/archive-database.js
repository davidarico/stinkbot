const { Pool } = require('pg');

// Main pool first: requiring it also loads the .env files in dev, so
// ARCHIVE_DATABASE_URL is visible below.
const mainPool = require('./database');

/**
 * Message archives live in a separate Postgres (self-hosted Pi at
 * dcc-pi.duckdns.org:5433) so archive bulk never counts against the Supabase
 * instance that holds live game state. Falls back to the main database when
 * ARCHIVE_DATABASE_URL is not set (local dev, tests).
 */
let archivePool;

if (process.env.ARCHIVE_DATABASE_URL) {
    archivePool = new Pool({
        connectionString: process.env.ARCHIVE_DATABASE_URL,
        // The Pi serves a self-signed cert for its DuckDNS hostname: encrypt,
        // but skip chain verification.
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || '10000', 10),
    });

    archivePool.on('connect', () => {
        console.log('✅ Connected to archive PostgreSQL database');
    });

    archivePool.on('error', (err) => {
        console.error('❌ Archive PostgreSQL connection error:', err);
    });
} else {
    console.log('🗄️ ARCHIVE_DATABASE_URL not set - archive uses the main database');
    archivePool = mainPool;
}

module.exports = archivePool;
