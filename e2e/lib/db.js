'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const { REPO_ROOT, LOCAL_DATABASE_URL, assertLocalDatabase } = require('./env');

const COMPOSE_FILE = path.join(__dirname, '..', 'docker-compose.yml');
const SEEDS_DIR = path.join(__dirname, '..', 'seeds');
const ARCHIVE_TABLE_SQL = path.join(REPO_ROOT, 'database', 'migrations',
    '20260714T002219_drop_archive_messages_moved_to_pi.rollback.sql');

function compose(...args) {
    execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], { stdio: 'inherit' });
}

async function withLocal(fn) {
    assertLocalDatabase(LOCAL_DATABASE_URL);
    // ssl: false explicitly - the user's shell exports PGSSLMODE=require, which pg would honor.
    const client = new Client({ connectionString: LOCAL_DATABASE_URL, ssl: false });
    await client.connect();
    try {
        return await fn(client);
    } finally {
        await client.end();
    }
}

function up() {
    compose('up', '-d', '--wait');
}

function down({ wipe = false } = {}) {
    compose('down', ...(wipe ? ['-v'] : []));
}

async function migrate() {
    execFileSync('node', ['migrate.js', 'migrate'], {
        cwd: path.join(REPO_ROOT, 'database'),
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: LOCAL_DATABASE_URL, PGSSLMODE: 'disable' },
    });
    // archive_messages moved to the Pi and was dropped from the main schema. The harness points
    // archive queries at this same database, so recreate it here.
    await withLocal(async (client) => {
        const { rows } = await client.query("SELECT to_regclass('public.archive_messages') AS t");
        if (!rows[0].t) await client.query(fs.readFileSync(ARCHIVE_TABLE_SQL, 'utf8'));
    });
}

async function reset() {
    down({ wipe: true });
    up();
    await migrate();
    await seed('base');
}

async function sql(query) {
    return withLocal(async (client) => {
        const result = await client.query(query);
        // Multi-statement queries return an array of results; show the last one.
        return Array.isArray(result) ? result[result.length - 1] : result;
    });
}

function listSeeds() {
    return fs.readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, ''));
}

async function seed(name) {
    const file = path.join(SEEDS_DIR, `${name}.sql`);
    if (!fs.existsSync(file)) {
        throw new Error(`No seed "${name}". Available: ${listSeeds().join(', ')}`);
    }
    await withLocal((client) => client.query(fs.readFileSync(file, 'utf8')));
    console.log(`🌱 Applied seed ${name}`);
}

module.exports = { up, down, migrate, reset, sql, seed, listSeeds, withLocal };
