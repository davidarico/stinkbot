'use strict';

const { Client, GatewayIntentBits, Partials, ChannelType, MessageType, PermissionsBitField } = require('discord.js');
const { DEV_GUILD_ID } = require('./env');

/**
 * Log in with the bot token. This is a second gateway session next to the production bot; it
 * registers no command listeners, so it never answers real messages - it only does what the
 * harness tells it to.
 */
async function login(token) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel, Partials.Message],
    });
    await client.login(token);
    if (!client.isReady()) await new Promise((resolve) => client.once('ready', resolve));
    return client;
}

async function getDevGuild(client) {
    const guild = await client.guilds.fetch(DEV_GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();
    await guild.members.fetch();

    // Discord allows one full member list request (gateway op 8) per guild every 30 seconds.
    // The fetch above just spent it, so a handler that calls guild.members.fetch() right
    // after would sit for 120s waiting on chunks that never come. Everything is cached now,
    // so answer whole-guild fetches from the cache; single-member fetches still hit the API.
    const fetchMembers = guild.members.fetch.bind(guild.members);
    guild.members.fetch = (options) => (
        options === undefined ? Promise.resolve(guild.members.cache) : fetchMembers(options)
    );
    return guild;
}

/** Resolve a channel by id or exact name, only inside the dev guild. */
function resolveChannel(guild, ref) {
    const channel = guild.channels.cache.get(ref)
        || guild.channels.cache.find((c) => c.name === ref);
    if (!channel) throw new Error(`No channel "${ref}" in ${guild.name}`);
    return channel;
}

async function resolveMember(guild, ref) {
    const id = ref.replace(/[<@!>]/g, '');
    const member = guild.members.cache.get(id)
        || guild.members.cache.find((m) => m.user.username === ref || m.displayName === ref);
    if (!member) throw new Error(`No member "${ref}" in ${guild.name}`);
    return member;
}

function describeEmbed(embed) {
    const e = embed.toJSON ? embed.toJSON() : embed;
    return {
        title: e.title,
        description: e.description,
        fields: (e.fields || []).map((f) => ({ name: f.name, value: f.value })),
        footer: e.footer?.text,
    };
}

function describeMessage(m) {
    return {
        id: m.id,
        channel: m.channel?.name || (m.channel?.type === ChannelType.DM ? 'DM' : m.channelId),
        author: m.author?.username,
        type: MessageType[m.type],
        createdAt: m.createdAt?.toISOString(),
        pinned: m.pinned,
        content: m.content,
        embeds: m.embeds.map(describeEmbed),
        components: m.components?.length || 0,
        reactions: [...(m.reactions?.cache.values() || [])].map((r) => `${r.emoji.name}×${r.count}`),
        url: m.url,
    };
}

async function fetchMessages(guild, channelRef, limit = 10) {
    const channel = resolveChannel(guild, channelRef);
    const messages = await channel.messages.fetch({ limit });
    return [...messages.values()].reverse().map(describeMessage);
}

function channelTree(guild) {
    const channels = [...guild.channels.cache.values()];
    const byParent = (parentId) => channels
        .filter((c) => (c.parentId || null) === parentId && c.type !== ChannelType.GuildCategory)
        .sort((a, b) => a.rawPosition - b.rawPosition);
    const lines = byParent(null).map((c) => `#${c.name}  (${c.id})`);
    const categories = channels.filter((c) => c.type === ChannelType.GuildCategory)
        .sort((a, b) => a.rawPosition - b.rawPosition);
    for (const cat of categories) {
        lines.push(`📁 ${cat.name}  (${cat.id})`);
        for (const c of byParent(cat.id)) lines.push(`   #${c.name}  (${c.id})`);
    }
    return lines.join('\n');
}

function describePermissions(guild, channelRef) {
    const channel = resolveChannel(guild, channelRef);
    return [...channel.permissionOverwrites.cache.values()].map((o) => {
        const target = o.type === 0
            ? `role:${guild.roles.cache.get(o.id)?.name ?? o.id}`
            : `user:${guild.members.cache.get(o.id)?.user.username ?? o.id}`;
        return {
            target,
            allow: new PermissionsBitField(o.allow).toArray(),
            deny: new PermissionsBitField(o.deny).toArray(),
        };
    });
}

function describeMember(member) {
    return {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        roles: member.roles.cache.filter((r) => r.name !== '@everyone').map((r) => r.name),
        administrator: member.permissions.has(PermissionsBitField.Flags.Administrator),
        manageChannels: member.permissions.has(PermissionsBitField.Flags.ManageChannels),
    };
}

module.exports = {
    login,
    getDevGuild,
    resolveChannel,
    resolveMember,
    describeMessage,
    fetchMessages,
    channelTree,
    describePermissions,
    describeMember,
};
