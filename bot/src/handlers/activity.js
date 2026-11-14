'use strict';

const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

// Message activity tracking (feedback #26, #27, #49, #67).
//
// Every message a human sends in an active game's category is counted into
// message_activity as it arrives, so Wolf.ia, Wolf.speed_check, Wolf.ia_history and
// Wolf.silent read a table instead of paging through the Discord API.
//
// Counts are bucketed by half hour (plus the game day and phase they were sent in).
// Half-hour buckets are what let the IA window start at any HH:00 or HH:30 without
// rewriting history when a server changes its reset time.

const IA_TIMEZONE = 'America/New_York';
const DEFAULT_IA_RESET_TIME = '09:30';
const ACTIVITY_BUCKET_MS = 30 * 60 * 1000;
// How long recordMessageActivity trusts its cached view of a server's active game.
// Phase changes invalidate the cache directly, so this only bounds staleness from
// changes made outside this process (the dashboard, a second bot instance).
const ACTIVITY_GAME_CACHE_MS = 60 * 1000;
// Longest name shown in the Wolf.ia_history table before truncating.
const HISTORY_NAME_WIDTH = 14;

// "HH:MM" on a half-hour boundary, or null. Accepts "0001"-style input loosely
// ("0:00", "00:00", "0000") because that is how mods write times.
function parseIaResetTime(input) {
    const match = String(input || '').trim().match(/^(\d{1,2}):?(\d{2})$/);
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 23 || (minutes !== 0 && minutes !== 30)) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Start of the IA window that contains `now`: the most recent reset time in Eastern.
function currentIaWindowStart(resetTime, now = moment.tz(IA_TIMEZONE)) {
    const [hours, minutes] = resetTime.split(':').map(Number);
    const start = now.clone().hour(hours).minute(minutes).second(0).millisecond(0);
    if (now.isBefore(start)) {
        start.subtract(1, 'day');
    }
    return start;
}

function bucketStartFor(date) {
    return new Date(Math.floor(date.getTime() / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS);
}

module.exports = {

parseIaResetTime,
currentIaWindowStart,

async getIaResetTime(serverId) {
    try {
        const result = await this.db.query(
            'SELECT ia_reset_time FROM server_configs WHERE server_id = $1',
            [serverId]
        );
        return parseIaResetTime(result.rows[0]?.ia_reset_time) || DEFAULT_IA_RESET_TIME;
    } catch (error) {
        console.error('Error loading IA reset time, using default:', error);
        return DEFAULT_IA_RESET_TIME;
    }
},

// The active game for a server, as far as activity tracking cares. Cached because
// this runs for every message on every server the bot is in.
async getActivityGame(serverId) {
    if (!this.activityGameCache) {
        this.activityGameCache = new Map();
    }

    const cached = this.activityGameCache.get(serverId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.game;
    }

    const result = await this.db.query(
        `SELECT id, category_id, day_number, day_phase, activity_tracked_since
         FROM games WHERE server_id = $1 AND status = $2 ORDER BY id DESC LIMIT 1`,
        [serverId, 'active']
    );
    const game = result.rows[0] || null;
    this.activityGameCache.set(serverId, { game, expiresAt: Date.now() + ACTIVITY_GAME_CACHE_MS });
    return game;
},

// Call whenever a game's status, day or phase changes so the next message is
// attributed to the right phase straight away.
invalidateActivityGameCache(serverId) {
    if (this.activityGameCache) {
        this.activityGameCache.delete(serverId);
    }
},

// Counts one message. Called for every non-bot message from index.js, so it must
// never throw and must stay cheap for messages outside a game.
async recordMessageActivity(message) {
    try {
        if (!message.guild || !message.channel || message.author?.bot) return;

        const game = await this.getActivityGame(message.guild.id);
        if (!game || !game.category_id || message.channel.parentId !== game.category_id) return;

        // Games that were already running when tracking shipped start counting at their
        // first message; readers compare this timestamp to the window they need.
        if (!game.activity_tracked_since) {
            const since = await this.db.query(
                'UPDATE games SET activity_tracked_since = COALESCE(activity_tracked_since, NOW()) WHERE id = $1 RETURNING activity_tracked_since',
                [game.id]
            );
            game.activity_tracked_since = since.rows[0]?.activity_tracked_since || new Date();
        }

        await this.db.query(
            `INSERT INTO message_activity (game_id, channel_id, user_id, day_number, day_phase, bucket_start, message_count)
             VALUES ($1, $2, $3, $4, $5, $6, 1)
             ON CONFLICT (game_id, channel_id, user_id, day_number, day_phase, bucket_start)
             DO UPDATE SET message_count = message_activity.message_count + 1`,
            [game.id, message.channel.id, message.author.id, game.day_number, game.day_phase,
                bucketStartFor(message.createdAt || new Date()).toISOString()]
        );
    } catch (error) {
        console.error('Error recording message activity:', error);
    }
},

// True when the tracker's numbers are complete for a window starting at `since`: it has
// been counting since then, or (given the channel) since before the channel existed,
// which is the normal case for a game started after tracking shipped.
isActivityTrackedSince(game, since, channel = null) {
    if (!game.activity_tracked_since) return false;
    const trackedSince = new Date(game.activity_tracked_since).getTime();
    if (trackedSince <= new Date(since).getTime()) return true;
    return Boolean(channel?.createdTimestamp) && trackedSince <= channel.createdTimestamp;
},

// userId -> message count from the tracker. `since` filters by half-hour bucket, so it
// must sit on a bucket boundary to be exact; `dayNumber`/`dayPhase` filter by game phase.
async countTrackedMessages(gameId, channelIds, { since = null, dayNumber = null, dayPhase = null } = {}) {
    const conditions = ['game_id = $1', 'channel_id = ANY($2)'];
    const params = [gameId, channelIds];

    if (since) {
        params.push(new Date(since).toISOString());
        conditions.push(`bucket_start >= $${params.length}`);
    }
    if (dayNumber !== null) {
        params.push(dayNumber);
        conditions.push(`day_number = $${params.length}`);
    }
    if (dayPhase !== null) {
        params.push(dayPhase);
        conditions.push(`day_phase = $${params.length}`);
    }

    const result = await this.db.query(
        `SELECT user_id, SUM(message_count)::int AS message_count
         FROM message_activity
         WHERE ${conditions.join(' AND ')}
         GROUP BY user_id`,
        params
    );
    return new Map(result.rows.map((row) => [row.user_id, row.message_count]));
},

// userId -> message count by paging the channel through the Discord API. Slow on busy
// channels; kept for windows the tracker can't answer (custom dates, games that were
// already running when tracking shipped).
async countMessagesByPaging(channel, since, userIds) {
    const counts = new Map();
    const wanted = new Set(userIds);
    let lastMessageId = null;

    // Discord API limits us to 100 messages per request, so we need to paginate
    while (true) {
        const options = { limit: 100 };
        if (lastMessageId) {
            options.before = lastMessageId;
        }

        const messages = await channel.messages.fetch(options);

        if (messages.size === 0) break;

        for (const msg of messages.values()) {
            if (msg.createdAt >= since && !msg.author.bot && wanted.has(msg.author.id)) {
                counts.set(msg.author.id, (counts.get(msg.author.id) || 0) + 1);
            }
        }

        // Check if we've gone past our date range
        const oldestMessage = messages.last();
        if (oldestMessage.createdAt < since) {
            break;
        }

        lastMessageId = oldestMessage.id;
    }

    return counts;
},

// The game's players who currently hold the Alive role.
async filterAlivePlayers(guild, players, aliveRole) {
    // OPTIMIZATION: Fetch all guild members at once instead of individual calls
    try {
        await guild.members.fetch();
    } catch (error) {
        console.log('Could not fetch all guild members, falling back to individual fetches');
        const alivePlayers = [];
        for (const player of players) {
            try {
                const member = await guild.members.fetch(player.user_id);
                if (member && member.roles.cache.has(aliveRole.id)) {
                    alivePlayers.push(player);
                }
            } catch (fetchError) {
                console.error(`Error checking role for player ${player.username}:`, fetchError);
                // Skip this player if we can't fetch them
            }
        }
        return alivePlayers;
    }

    // Use cached members for much faster processing
    return players.filter((player) => {
        const member = guild.members.cache.get(player.user_id);
        return member && member.roles.cache.has(aliveRole.id);
    });
},

// Alive players with no messages in the public game channels during the current game
// day (feedback #26). Wolf chat and other private channels are left out on purpose so
// the list can't leak who is talking where.
async handleSilent(message) {
    const serverId = message.guild.id;

    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];

    if (!game.activity_tracked_since) {
        return message.reply('❌ No message activity has been tracked for this game yet.');
    }

    const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
    if (!aliveRole) {
        return message.reply('❌ Alive role not found. Please use `Wolf.server_roles` to set up roles.');
    }

    try {
        const playersResult = await this.db.query(
            'SELECT user_id, username FROM players WHERE game_id = $1',
            [game.id]
        );
        const alivePlayers = await this.filterAlivePlayers(message.guild, playersResult.rows, aliveRole);

        if (alivePlayers.length === 0) {
            return message.reply('❌ No alive players found in the current game.');
        }

        const publicChannelIds = [game.town_square_channel_id, game.voting_booth_channel_id, game.memos_channel_id]
            .filter(id => id);
        const counts = await this.countTrackedMessages(game.id, publicChannelIds, { dayNumber: game.day_number });

        const silent = alivePlayers
            .filter((player) => !counts.get(player.user_id))
            .map((player) => player.username)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        const body = silent.length
            ? silent.map((name, i) => `${i + 1}. ${name}`).join('\n')
            : 'Every alive player has posted today.';

        const embed = new EmbedBuilder()
            .setTitle(`🤫 Silent players - Day ${game.day_number}`)
            .setDescription(`Alive players with no messages in town square, voting booth or memos since Day ${game.day_number} began.\n\n${body}`.slice(0, 4000))
            .setColor(0xE67E22)
            .setTimestamp();

        // The start of the current day number isn't stored, only the last phase change,
        // so this is the closest check available for "tracking began partway through".
        if (!this.isActivityTrackedSince(game, game.phase_change_at)) {
            embed.setFooter({ text: 'Tracking started partway through this phase, so earlier messages are not counted.' });
        }

        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in handleSilent:', error);
        await message.reply('❌ Could not build the silent player list.');
    }
},

// Per-player message totals for every IA day of the game (feedback #27, #67).
// Usage: Wolf.ia_history [channel] [minimum]. With a minimum, days under it are marked.
async handleIAHistory(message, args) {
    const serverId = message.guild.id;

    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];

    if (!game.activity_tracked_since) {
        return message.reply('❌ No message activity has been tracked for this game yet.');
    }

    // Arguments in any order: a number is the minimum, anything else is a channel
    let minimum = null;
    let channelArg = null;
    for (const arg of args || []) {
        if (/^\d{1,4}$/.test(arg)) {
            minimum = parseInt(arg, 10);
        } else {
            channelArg = arg;
        }
    }

    try {
        let channelId = game.town_square_channel_id;
        if (channelArg) {
            const mentionMatch = channelArg.match(/^<#(\d+)>$/);
            const wantedName = channelArg.replace(/^#/, '').trim().toLowerCase();
            const found = mentionMatch || /^\d{15,}$/.test(channelArg)
                ? message.guild.channels.cache.get(mentionMatch ? mentionMatch[1] : channelArg)
                : message.guild.channels.cache.find(ch => ch && typeof ch.name === 'string' && ch.name.toLowerCase() === wantedName);
            if (!found) {
                return message.reply(`❌ Channel not found: \`${channelArg}\`. Usage: \`Wolf.ia_history [channel] [minimum]\``);
            }
            channelId = found.id;
        }

        const resetTime = await this.getIaResetTime(serverId);

        // An IA day runs from one reset time to the next, in Eastern time. Shifting each
        // bucket back by the reset time turns that window into a plain calendar date.
        const historyResult = await this.db.query(
            `SELECT user_id,
                    to_char((bucket_start AT TIME ZONE '${IA_TIMEZONE}') - $3::interval, 'YYYY-MM-DD') AS ia_day,
                    SUM(message_count)::int AS message_count
             FROM message_activity
             WHERE game_id = $1 AND channel_id = $2
             GROUP BY user_id, ia_day`,
            [game.id, channelId, `${resetTime}:00`]
        );

        const playersResult = await this.db.query(
            'SELECT user_id, username FROM players WHERE game_id = $1 ORDER BY username',
            [game.id]
        );

        if (playersResult.rows.length === 0) {
            return message.reply('❌ No players found in the current game.');
        }

        // Every IA day from the first tracked one through today, including empty days
        const [resetHours, resetMinutes] = resetTime.split(':').map(Number);
        const toIaDay = (date) => moment.tz(date, IA_TIMEZONE)
            .subtract(resetHours, 'hours').subtract(resetMinutes, 'minutes').startOf('day');
        const today = toIaDay(new Date());
        const days = [];
        for (const day = toIaDay(game.activity_tracked_since); !day.isAfter(today); day.add(1, 'day')) {
            days.push(day.format('YYYY-MM-DD'));
        }

        const countsByUser = new Map();
        for (const row of historyResult.rows) {
            if (!countsByUser.has(row.user_id)) countsByUser.set(row.user_id, new Map());
            countsByUser.get(row.user_id).set(row.ia_day, row.message_count);
        }

        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        const alivePlayers = aliveRole
            ? await this.filterAlivePlayers(message.guild, playersResult.rows, aliveRole)
            : playersResult.rows;
        const aliveIds = new Set(alivePlayers.map((player) => player.user_id));

        const todayKey = days[days.length - 1];
        const underMinimum = new Map(days.map((day) => [day, []]));

        const header = `${'Player'.padEnd(HISTORY_NAME_WIDTH)} ${days.map((day) => day.slice(5).replace('-', '/')).join(' ')}`;
        const rows = playersResult.rows.map((player) => {
            const counts = countsByUser.get(player.user_id) || new Map();
            // Dead players stop posting, so the days after their last message say
            // nothing about IA. Show those as "-" instead of a string of zeroes.
            let lastActiveIndex = days.length - 1;
            if (!aliveIds.has(player.user_id)) {
                lastActiveIndex = -1;
                days.forEach((day, i) => { if (counts.get(day)) lastActiveIndex = i; });
            }

            const cells = days.map((day, i) => {
                if (i > lastActiveIndex) return '-'.padStart(5);
                const count = counts.get(day) || 0;
                // Today is still in progress, so it is never marked as under the minimum
                const flagged = minimum !== null && count < minimum && day !== todayKey;
                if (flagged) underMinimum.get(day).push(player.username);
                return `${count}${flagged ? '*' : ''}`.padStart(5);
            });

            const name = player.username.length > HISTORY_NAME_WIDTH
                ? `${player.username.slice(0, HISTORY_NAME_WIDTH - 1)}…`
                : player.username;
            return `${name.padEnd(HISTORY_NAME_WIDTH)} ${cells.join(' ')}`;
        });

        const trackedSince = Math.floor(new Date(game.activity_tracked_since).getTime() / 1000);
        let intro = `📊 **IA history** for <#${channelId}> - messages per IA day (resets ${resetTime} ET, last column is today so far). Tracked since <t:${trackedSince}:f>.`;
        if (minimum !== null) {
            intro += `\n\`*\` = under ${minimum} messages.`;
        }

        // Code blocks keep the columns aligned; split on row boundaries to stay under
        // Discord's 2000 character message limit.
        const chunks = [];
        let current = [header];
        let currentLength = header.length;
        for (const row of rows) {
            if (currentLength + row.length + 1 > 1800) {
                chunks.push(current);
                current = [header];
                currentLength = header.length;
            }
            current.push(row);
            currentLength += row.length + 1;
        }
        chunks.push(current);

        await message.reply(`${intro}\n\`\`\`\n${chunks[0].join('\n')}\n\`\`\``);
        for (const chunk of chunks.slice(1)) {
            await message.channel.send(`\`\`\`\n${chunk.join('\n')}\n\`\`\``);
        }

        if (minimum !== null) {
            const violationLines = days
                .filter((day) => day !== todayKey && underMinimum.get(day).length > 0)
                .map((day) => `**${day.slice(5).replace('-', '/')}**: ${underMinimum.get(day).join(', ')}`);
            const summary = violationLines.length
                ? `**Under ${minimum} messages:**\n${violationLines.join('\n')}`
                : `Nobody was under ${minimum} messages on a finished day.`;
            await message.channel.send(summary.slice(0, 1900));
        }
    } catch (error) {
        console.error('Error in handleIAHistory:', error);
        await message.reply('❌ Could not build the IA history.');
    }
},

};
