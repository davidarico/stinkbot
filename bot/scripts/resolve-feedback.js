#!/usr/bin/env node
/**
 * Resolve feedback: DM the submitter that their feedback was resolved, then
 * delete the row from the feedback table.
 *
 * Usage (from repo root):
 *   node bot/scripts/resolve-feedback.js <id> [<id> ...] [--note "text"] [--dry-run] [--no-dm] [--json]
 *
 *   --note "text"  Extra information included in the DM (same note for every id)
 *   --dry-run      Show what would be sent; no DM, no delete
 *   --no-dm        Delete without messaging (spam, duplicates, non-actionable)
 *   --json         Print results as JSON instead of text
 *
 * Exits 1 if any id was not found or its DM failed; those rows are left in place.
 *
 * Env: DATABASE_URL and DISCORD_TOKEN, loaded from database/.env, .env, and
 * bot/.env (first file wins per variable, so DATABASE_URL matches the bot and
 * migrations). DISCORD_TOKEN must be the production bot - Discord only allows
 * DMs to users who share a server with the bot.
 */
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');
for (const envPath of [
    path.join(repoRoot, 'database', '.env'),
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'bot', '.env'),
]) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
    }
}

const USAGE = 'Usage: node bot/scripts/resolve-feedback.js <id> [<id> ...] [--note "text"] [--dry-run] [--no-dm] [--json]';

function parseArgs(argv) {
    const opts = { ids: [], note: '', dryRun: false, sendDm: true, json: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--note') {
            if (i + 1 >= argv.length) throw new Error('--note needs a value');
            opts.note = argv[++i].trim();
        } else if (arg === '--dry-run') {
            opts.dryRun = true;
        } else if (arg === '--no-dm') {
            opts.sendDm = false;
        } else if (arg === '--json') {
            opts.json = true;
        } else if (/^\d+$/.test(arg)) {
            opts.ids.push(parseInt(arg, 10));
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!opts.ids.length) throw new Error('At least one feedback id is required');
    if (opts.note && !opts.sendDm) throw new Error('--note has no effect with --no-dm');
    return opts;
}

function printResult(result) {
    const who = result.displayName ? ` (${result.displayName}, ${result.userId})` : '';
    switch (result.status) {
        case 'resolved':
            console.log(`✅ #${result.id}${who} resolved${result.dmSent ? ', DM sent' : ', no DM'}`);
            break;
        case 'would_resolve':
            console.log(`🔍 #${result.id}${who} would be resolved: "${result.feedbackText}"`);
            if (result.dm) {
                console.log(`   DM title: ${result.dm.title}`);
                console.log(result.dm.description.split('\n').map((line) => `   | ${line}`).join('\n'));
            } else {
                console.log('   No DM (--no-dm)');
            }
            break;
        case 'not_found':
            console.log(`❌ #${result.id} not found`);
            break;
        case 'dm_failed':
            console.log(`❌ #${result.id}${who} DM failed (${result.error}); row kept. Re-run with --no-dm to resolve without messaging.`);
            break;
    }
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`❌ ${error.message}\n${USAGE}`);
        process.exit(2);
    }

    if (opts.sendDm && !opts.dryRun && !process.env.DISCORD_TOKEN) {
        console.error('❌ DISCORD_TOKEN is not set (checked database/.env, .env, bot/.env)');
        process.exit(2);
    }

    // Keep stdout pure JSON: database.js and pg log connection chatter via console.log
    if (opts.json) {
        console.log = console.error;
    }

    // Required late so a usage error doesn't need a database
    const db = require('../src/database');
    const { REST } = require('discord.js');
    const { resolveFeedback } = require('../src/feedback-resolver');

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || '');
    let results;
    try {
        results = await resolveFeedback({ db, rest, ...opts });
    } finally {
        await db.end();
    }

    if (opts.json) {
        process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    } else {
        results.forEach(printResult);
    }

    const failed = results.some((r) => r.status === 'not_found' || r.status === 'dm_failed');
    process.exit(failed ? 1 : 0);
}

main().catch((error) => {
    console.error('❌ resolve-feedback failed:', error);
    process.exit(1);
});
