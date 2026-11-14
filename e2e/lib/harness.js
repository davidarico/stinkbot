'use strict';

const util = require('util');
const { Collection, PermissionsBitField } = require('discord.js');
const { resolveChannel, resolveMember, describeMessage } = require('./discord');

// Roles that make someone a mod or super user in the bot's eyes; hidden in --player mode.
const PRIVILEGED_ROLE_NAMES = ['Mod', 'Town Council'];
const HARNESS_MARKER = '🧪 e2e';

/**
 * The trigger message is sent with mentions suppressed (nobody should get pinged by a test run),
 * which also leaves its `mentions` empty. Rebuild what the bot would have seen from the
 * `<@id>` / `<#id>` tokens in the command, resolved against the dev guild's caches.
 */
function mentionsFrom(guild, content) {
    const members = new Collection();
    const users = new Collection();
    const channels = new Collection();
    for (const [, id] of content.matchAll(/<@!?(\d+)>/g)) {
        const member = guild.members.cache.get(id);
        if (!member) continue;
        members.set(id, member);
        users.set(id, member.user);
    }
    for (const [, id] of content.matchAll(/<#(\d+)>/g)) {
        const channel = guild.channels.cache.get(id);
        if (channel) channels.set(id, channel);
    }
    return { members, users, channels };
}

/**
 * Wrap a real message so the bot sees it as sent by `actor` with `content`. Everything else
 * (channel, guild, reply, delete, url) comes from the real message, so replies thread onto it
 * in Discord. Mentions are rebuilt from `content` (see mentionsFrom).
 */
function impersonate(realMessage, actor, content) {
    const msg = Object.create(realMessage);
    Object.defineProperties(msg, {
        author: { value: actor.user, enumerable: true },
        member: { value: actor, enumerable: true },
        content: { value: content, enumerable: true },
        mentions: { value: mentionsFrom(realMessage.guild, content), enumerable: true },
    });
    return msg;
}

/**
 * David is the only human on the dev server and he is an Administrator, so every command
 * normally runs down the mod path. --player strips the mod signals (permissions and the Mod /
 * Town Council roles) from the bot's view of him. Role add/remove calls still hit the real member.
 */
function asPlayer(member) {
    const actor = Object.create(member);
    const roles = Object.create(member.roles);
    const visibleRoles = member.roles.cache.filter((r) => !PRIVILEGED_ROLE_NAMES.includes(r.name));
    Object.defineProperty(roles, 'cache', { value: visibleRoles });
    Object.defineProperties(actor, {
        roles: { value: roles },
        permissions: { value: new PermissionsBitField(member.guild.roles.everyone.permissions).freeze() },
    });
    return actor;
}

function captureConsole() {
    const logs = [];
    const originals = {};
    for (const level of ['log', 'info', 'warn', 'error']) {
        originals[level] = console[level];
        console[level] = (...args) => logs.push({ level, text: util.format(...args) });
    }
    return {
        logs,
        restore() {
            Object.assign(console, originals);
        },
    };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run one bot command for real against the dev guild.
 *
 * Posts a visible trigger message (as the bot, mentions suppressed), hands an impersonated copy
 * to WerewolfBot.handleMessage, answers any `awaitMessages` prompts with `answers`, then reports
 * every message the bot created / edited / deleted in the guild or DMs, plus everything the bot
 * logged while it ran.
 */
async function runCommand({ client, guild, bot, command, channelRef, asRef, player = false,
    answers = [], settleMs = 1500, timeoutMs = 120000 }) {
    const channel = resolveChannel(guild, channelRef);
    const member = await resolveMember(guild, asRef);
    const actor = player ? asPlayer(member) : member;

    const created = new Collection();
    const edited = new Collection();
    const deleted = [];
    const ignore = new Set();
    // Trigger/answer messages are matched by marker too: their messageCreate can fire before
    // send() resolves with the id.
    const fromBot = (m) => m.author?.id === client.user.id && !ignore.has(m.id)
        && !m.content?.startsWith(HARNESS_MARKER) && (m.guildId === guild.id || !m.guildId);
    const onCreate = (m) => { if (fromBot(m)) created.set(m.id, m); };
    const onUpdate = (_old, m) => { if (fromBot(m) && !created.has(m.id)) edited.set(m.id, m); };
    const onDelete = (m) => { if (m.guildId === guild.id) deleted.push({ id: m.id, channel: m.channel?.name }); };
    const reactions = [];
    const onReact = (reaction, user) => {
        if (user.id === client.user.id && reaction.message.guildId === guild.id) {
            reactions.push({ emoji: reaction.emoji.name, channel: reaction.message.channel?.name, message: reaction.message.id });
        }
    };
    client.on('messageCreate', onCreate);
    client.on('messageUpdate', onUpdate);
    client.on('messageDelete', onDelete);
    client.on('messageReactionAdd', onReact);

    const label = `${HARNESS_MARKER} as **${member.displayName}**${player ? ' (player view)' : ''}`;
    const trigger = await channel.send({ content: `${label}: ${command}`, allowedMentions: { parse: [] } });
    ignore.add(trigger.id);

    const capture = captureConsole();
    let handlerError = null;
    const started = Date.now();
    try {
        const run = bot.handleMessage(impersonate(trigger, actor, command))
            .catch((error) => { handlerError = error; });

        for (const answer of answers) {
            // Wait for the bot's prompt (any new bot message) before answering.
            const seen = created.size;
            const deadline = Date.now() + 15000;
            while (created.size === seen && Date.now() < deadline) await sleep(250);
            const answerMsg = await channel.send({ content: `${label} answers: ${answer}`, allowedMentions: { parse: [] } });
            ignore.add(answerMsg.id);
            // Collectors listen on the client, so emitting the impersonated copy satisfies their
            // author filter; the real (bot-authored) answer message is ignored by them.
            client.emit('messageCreate', impersonate(answerMsg, actor, answer));
        }

        const finished = await Promise.race([run.then(() => true), sleep(timeoutMs).then(() => false)]);
        if (!finished) handlerError = new Error(`Handler still running after ${timeoutMs}ms`);
        await sleep(settleMs);
    } finally {
        capture.restore();
        client.off('messageCreate', onCreate);
        client.off('messageUpdate', onUpdate);
        client.off('messageDelete', onDelete);
        client.off('messageReactionAdd', onReact);
    }

    const errors = capture.logs.filter((l) => l.level === 'error');
    return {
        command,
        as: `${member.user.username}${player ? ' (player view)' : ''}`,
        channel: channel.name,
        trigger: trigger.url,
        durationMs: Date.now() - started,
        handlerError: handlerError ? (handlerError.stack || String(handlerError)) : null,
        errorCount: errors.length + (handlerError ? 1 : 0),
        created: [...created.values()].map(describeMessage),
        edited: [...edited.values()].map(describeMessage),
        deleted,
        reactions,
        logs: capture.logs,
    };
}

module.exports = { runCommand, impersonate, asPlayer };
