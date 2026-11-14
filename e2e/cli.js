#!/usr/bin/env node
'use strict';

// E2E harness for StinkBot: drive real commands against Dave's Dev Deck with a local Postgres.
// See e2e/README.md. Run from the repo root: `npm run e2e -- <command> ...`.

const env = require('./lib/env');
const db = require('./lib/db');

const USAGE = `Usage: npm run e2e -- <command> [args]

Database (local Docker Postgres on :54329):
  db up | down | reset | migrate        reset = wipe + migrate + seed base
  db seed <name>                        apply e2e/seeds/<name>.sql
  db sql "<query>"                      run SQL, print rows as JSON

Discord (Dave's Dev Deck only):
  run "<Wolf.cmd ...>" [options]        run a bot command for real and report what happened
      --channel <name|id>               where it is "typed" (default: general)
      --as <user|id>                    who "types" it (default: David)
      --player                          hide David's admin perms / Mod role from the bot
      --answer <text>                   reply to an awaitMessages prompt (repeatable, in order)
      --settle <ms>                     wait after the handler returns (default 1500)
      --json                            full JSON report
  messages <channel> [--limit N] [--json]
  channels                              channel tree with ids
  roles                                 server roles
  member [user]                         a member's roles and mod-relevant permissions
  perms <channel>                       permission overwrites on a channel
  cleanup [--dry-run] [--roles]         delete "E2E Game *" categories (+ strip game roles)`;

function parseArgs(argv) {
    const positional = [];
    const flags = { answer: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) { positional.push(arg); continue; }
        const key = arg.slice(2);
        const takesValue = ['channel', 'as', 'answer', 'settle', 'limit'].includes(key);
        const value = takesValue ? argv[++i] : true;
        if (key === 'answer') flags.answer.push(value);
        else flags[key] = value;
    }
    return { positional, flags };
}

async function withDiscord(fn) {
    const token = env.configureBotEnv();
    try {
        await db.sql('SELECT 1');
    } catch (error) {
        throw new Error(`Local e2e DB not reachable (${error.message}). Run: npm run e2e -- db reset`);
    }
    const { login, getDevGuild } = require('./lib/discord');
    const client = await login(token);
    try {
        const guild = await getDevGuild(client);
        return await fn(client, guild);
    } finally {
        await client.destroy();
    }
}

function printRun(report) {
    const out = [];
    out.push(`▶ ${report.command}  (as ${report.as} in #${report.channel}, ${report.durationMs}ms)`);
    out.push(`  trigger: ${report.trigger}`);
    for (const m of report.created) out.push(formatMessage('＋', m));
    for (const m of report.edited) out.push(formatMessage('✎', m));
    for (const d of report.deleted) out.push(`  ✖ deleted ${d.id} in #${d.channel}`);
    for (const r of report.reactions) out.push(`  ☺ reacted ${r.emoji} on ${r.message} in #${r.channel}`);
    if (report.created.length === 0 && report.edited.length === 0) out.push('  (bot posted nothing)');
    const errors = report.logs.filter((l) => l.level === 'error' || l.level === 'warn');
    if (report.handlerError) out.push(`\n‼ handler threw:\n${report.handlerError}`);
    if (errors.length) {
        out.push(`\n‼ ${errors.length} error/warn log line(s):`);
        for (const l of errors) out.push(`  [${l.level}] ${l.text}`);
    }
    out.push(report.errorCount ? `\n❌ ${report.errorCount} error(s)` : '\n✅ no errors logged');
    console.log(out.join('\n'));
}

function formatMessage(marker, m) {
    const system = ['Default', 'Reply'].includes(m.type) ? '' : ` (${m.type})`;
    const lines = [`  ${marker} #${m.channel}${m.pinned ? ' 📌' : ''}${system}: ${m.content || ''}`.trimEnd()];
    for (const e of m.embeds) {
        if (e.title) lines.push(`      [embed] ${e.title}`);
        if (e.description) lines.push(indent(e.description, 8));
        for (const f of e.fields) lines.push(`        • ${f.name} (${f.value.length} chars)`);
        if (e.footer) lines.push(`        footer: ${e.footer}`);
    }
    if (m.components) lines.push(`      [${m.components} component row(s)]`);
    return lines.join('\n');
}

function indent(text, n) {
    return text.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
}

async function main() {
    const { positional, flags } = parseArgs(process.argv.slice(2));
    const [cmd, ...rest] = positional;

    switch (cmd) {
        case 'db': {
            const [sub, arg] = rest;
            if (sub === 'up') return db.up();
            if (sub === 'down') return db.down();
            if (sub === 'migrate') return db.migrate();
            if (sub === 'reset') return db.reset();
            if (sub === 'seed') return db.seed(arg);
            if (sub === 'sql') {
                const result = await db.sql(arg);
                console.log(JSON.stringify(result.rows ?? [], null, 2));
                if (result.command && !result.rows?.length) console.log(`${result.command} ${result.rowCount ?? ''}`);
                return;
            }
            break;
        }
        case 'run': {
            const command = rest[0];
            if (!command) break;
            return withDiscord(async (client, guild) => {
                // Required only now: bot/src/database.js reads DATABASE_URL at require time.
                const WerewolfBot = require('../bot/src/werewolf-bot');
                const botDb = require('../bot/src/database');
                const bot = new WerewolfBot(client, botDb);
                const { runCommand } = require('./lib/harness');
                const report = await runCommand({
                    client, guild, bot, command,
                    channelRef: flags.channel || 'general',
                    asRef: flags.as || env.DEFAULT_USER_ID,
                    player: Boolean(flags.player),
                    answers: flags.answer,
                    settleMs: flags.settle ? Number(flags.settle) : undefined,
                });
                await botDb.end?.();
                if (flags.json) console.log(JSON.stringify(report, null, 2));
                else printRun(report);
                if (report.errorCount) process.exitCode = 1;
            });
        }
        case 'messages':
            if (!rest[0]) break;
            return withDiscord(async (_client, guild) => {
                const { fetchMessages } = require('./lib/discord');
                const messages = await fetchMessages(guild, rest[0], flags.limit ? Number(flags.limit) : 10);
                if (flags.json) console.log(JSON.stringify(messages, null, 2));
                else console.log(messages.map((m) => formatMessage(`${m.createdAt} ${m.author}`, m)).join('\n'));
            });
        case 'channels':
            return withDiscord(async (_client, guild) => {
                console.log(require('./lib/discord').channelTree(guild));
            });
        case 'roles':
            return withDiscord(async (_client, guild) => {
                const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
                for (const r of roles) console.log(`${r.name}  (${r.id})  members: ${r.members.size}`);
            });
        case 'member':
            return withDiscord(async (_client, guild) => {
                const { resolveMember, describeMember } = require('./lib/discord');
                const member = await resolveMember(guild, rest[0] || env.DEFAULT_USER_ID);
                console.log(JSON.stringify(describeMember(member), null, 2));
            });
        case 'perms':
            if (!rest[0]) break;
            return withDiscord(async (_client, guild) => {
                const { describePermissions } = require('./lib/discord');
                console.log(JSON.stringify(describePermissions(guild, rest[0]), null, 2));
            });
        case 'cleanup':
            return withDiscord(async (_client, guild) => cleanup(guild, flags));
        default:
            break;
    }
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
}

const GAME_ROLE_NAMES = ['Signed Up', 'Alive', 'Dead'];

async function cleanup(guild, flags) {
    const { ChannelType } = require('discord.js');
    const categories = guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildCategory && /^E2E Game \d+$/.test(c.name)
    );
    for (const category of categories.values()) {
        const children = guild.channels.cache.filter((c) => c.parentId === category.id);
        console.log(`${flags['dry-run'] ? 'would delete' : 'deleting'} 📁 ${category.name} (+${children.size} channels)`);
        if (flags['dry-run']) continue;
        for (const child of children.values()) await child.delete('e2e cleanup');
        await category.delete('e2e cleanup');
    }
    if (categories.size === 0) console.log('No "E2E Game N" categories to delete');

    if (flags.roles) {
        for (const member of guild.members.cache.filter((m) => !m.user.bot).values()) {
            const remove = member.roles.cache.filter((r) => GAME_ROLE_NAMES.includes(r.name));
            if (remove.size === 0) continue;
            console.log(`${flags['dry-run'] ? 'would strip' : 'stripping'} ${remove.map((r) => r.name).join(', ')} from ${member.user.username}`);
            if (!flags['dry-run']) await member.roles.remove(remove, 'e2e cleanup');
        }
    }
}

main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
}).then(() => process.exit(process.exitCode || 0));
