'use strict';

// Must be required before anything from bot/src. bot/src/database.js reads DATABASE_URL at
// require time and loads database/.env through dotenv, which never overrides keys already set
// here - so setting them first is what keeps the harness off the production databases.

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Dave's Dev Deck. The only guild the harness will touch.
const DEV_GUILD_ID = '1399411876550676531';
// David (pedgma). Default identity for commands; has Administrator on the dev server.
const DEFAULT_USER_ID = '162675596772638720';

const LOCAL_DATABASE_URL = 'postgres://stinkbot:stinkbot@localhost:54329/stinkbot_e2e';

function readBotEnv() {
    const envPath = path.join(REPO_ROOT, 'bot', '.env');
    if (!fs.existsSync(envPath)) return {};
    return dotenv.parse(fs.readFileSync(envPath));
}

function readMainDatabaseUrl() {
    // Production main DB, used read-only by `seed from-prod`.
    for (const file of ['database/.env', '.env', 'bot/.env']) {
        const envPath = path.join(REPO_ROOT, file);
        if (!fs.existsSync(envPath)) continue;
        const parsed = dotenv.parse(fs.readFileSync(envPath));
        if (parsed.DATABASE_URL) return parsed.DATABASE_URL;
    }
    return null;
}

function assertLocalDatabase(url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) {
        throw new Error(`Refusing to run e2e against non-local database host "${host}"`);
    }
}

function configureBotEnv() {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = LOCAL_DATABASE_URL;
    // Empty (not unset) so dotenv can't fill it from database/.env; archive-database.js then
    // falls back to the main (local) pool instead of the Pi.
    process.env.ARCHIVE_DATABASE_URL = '';
    process.env.BOT_PREFIX = 'Wolf.';
    // David's shell exports PG* pointing at Supabase (PGSSLMODE=require among them). pg reads
    // these as fallbacks, so clear them and force plain TCP for the local container.
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('PG')) delete process.env[key];
    }
    process.env.PGSSLMODE = 'disable';
    // Optional services stay off: no OpenAI, S3 uploads or OpenSearch from test runs.
    for (const key of ['OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION',
        'AWS_S3_BUCKET_NAME', 'OPENSEARCH_DOMAIN_ENDPOINT']) {
        process.env[key] = '';
    }
    assertLocalDatabase(process.env.DATABASE_URL);

    const token = process.env.E2E_DISCORD_TOKEN || readBotEnv().DISCORD_TOKEN;
    if (!token) throw new Error('No Discord token: set E2E_DISCORD_TOKEN or DISCORD_TOKEN in bot/.env');
    return token;
}

module.exports = {
    REPO_ROOT,
    DEV_GUILD_ID,
    DEFAULT_USER_ID,
    LOCAL_DATABASE_URL,
    configureBotEnv,
    readMainDatabaseUrl,
    assertLocalDatabase,
};
