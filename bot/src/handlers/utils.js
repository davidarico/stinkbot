'use strict';

const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

// https://discord.com/developers/docs/topics/permissions
const PIN_PERMISSION = 0x0008000000000000;

// The word "lynch" must never appear in user-facing bot output (feedback IDs 84/85).
// Replacements match the game's existing terminology (e.g. the votes_to_hang setting
// and "vote them out" in the default day message). Longer forms are listed first so
// they are replaced before the bare word.
const BANNED_WORD_REPLACEMENTS = [
    [/lynchings/gi, 'hangings'],
    [/lynching/gi, 'hanging'],
    [/lynched/gi, 'hanged'],
    [/lynches/gi, 'hangs'],
    [/lynch/gi, 'hang']
];

function matchCase(replacement, original) {
    if (original === original.toUpperCase()) {
        return replacement.toUpperCase();
    }
    if (original[0] === original[0].toUpperCase()) {
        return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
}

module.exports = {

removeBannedWords(text) {
    if (!text) return text;
    let result = text;
    for (const [pattern, replacement] of BANNED_WORD_REPLACEMENTS) {
        result = result.replace(pattern, (match) => matchCase(replacement, match));
    }
    return result;
},

async generateFunnyResponse(command, username) {
    if (!this.openai) {
        return null;
    }

    try {
        const prompt = `You are a Discord bot for a Werewolf (mafia) game. A user tried to use an unknown command: "${command}". 
            Generate a funny, short response (1-2 sentences max) that:
            - Is playful and slightly sarcastic
            - Is a possible response to the command
            - Keeps the tone light and entertaining
            - Doesn't exceed 2 sentences
            - Crass and vulgar language is allowed
            - Never uses the word "lynch" or any variation of it; say "vote out" or "hang" instead

            Do not allude to the fact that the command is unknown.
        `;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'You are a sassy Discord bot that responds to unknown commands with short, funny messages that could be a possible response to the command.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: 100,
            temperature: 0.8
        });

        const content = response.choices[0]?.message?.content?.trim() || null;
        if (!content) return null;
        
        // Remove extra quotes from the beginning and end of the response
        let cleanedContent = content;
        
        // Remove quotes from the beginning
        while (cleanedContent.startsWith('"') || cleanedContent.startsWith('"') || cleanedContent.startsWith("'") || cleanedContent.startsWith("'")) {
            cleanedContent = cleanedContent.slice(1);
        }
        
        // Remove quotes from the end
        while (cleanedContent.endsWith('"') || cleanedContent.endsWith('"') || cleanedContent.endsWith("'") || cleanedContent.endsWith("'")) {
            cleanedContent = cleanedContent.slice(0, -1);
        }

        // Never let banned words (e.g. "lynch") reach users, even if the model ignores the prompt
        return this.removeBannedWords(cleanedContent);
    } catch (error) {
        console.error('Error generating OpenAI response:', error);
        return null;
    }
},

async handleHelp(message) {
    const isAdmin = this.hasModeratorPermissions(message.member);
    
    const embed = new EmbedBuilder()
        .setTitle('🐺 Werewolf Bot Commands')
        .setDescription('Here are the available commands:')
        .setColor(0x3498DB);

    // Player commands (everyone can use) - grouped together
    embed.addFields(
            { 
            name: '👥 Player Commands', 
            value: 
                '`Wolf.in` - Sign up for the current game\n' +
                '`Wolf.out` - Remove yourself from the current game\n' +
                '`Wolf.vote @user` - Vote for a player (voting booth, day phase only)\n' +
                '`Wolf.retract` - Retract your current vote\n' +
                '`Wolf.alive` - Show all players currently alive\n' +
                '`Wolf.players` - Show all players dead or alive\n' +
                '`Wolf.my_journal` - 📔 Find your personal journal channel\n' +
                '`Wolf.rename_journal <new-name>` - 📝 Rename your personal journal\n' +
                '`Wolf.meme` - 😤 I dare you to try me\n' +
                '`Wolf.help` - Show this help message\n' +
                '`Wolf.feedback` - Submit feedback to Stinky\n' +
                '`Wolf.votecount` - Vote totals only (no voter names; Day 2+ day phase)\n' +
                '`Wolf.iaself` - Your message count (same defaults as `Wolf.ia`, yourself only)\n' +
                '`Wolf.speed_check` - Message counts since last phase change (town square)',
            inline: false 
        }
    );

    // Super user commands (requires membership in super_users table)
    embed.addFields(
        {
            name: '🛡️ Super User Commands',
            value:
                '`Wolf.mod @user` - Grant the Mod role to a user (super users only)\n' +
                '`Wolf.unmod` - See moderator section: super users can remove Mod from anyone; moderators can `Wolf.unmod me`',
            inline: false
        }
    );

    // Admin commands (only if user is admin) - grouped by category
    if (isAdmin) {
        embed.addFields(
            { 
                name: '⚙️ Setup & Game Management', 
                value: 
                    '`Wolf.setup` - Initial server setup (prefix, starting number, game name)\n' +
                    '`Wolf.server_roles` - 🎭 Create all game roles\n' +
                    '`Wolf.create` - Create a new game with signup channel\n' +
                    '`Wolf.start [dark]` - Start the game and create all channels (use `dark` to hide Townsquare, Memos, and Voting Booth from Alive role)\n' +
                    '`Wolf.settings` - View/change game and channel settings (votes_to_hang, messages)\n' +
                    '`Wolf.channel_config` - View additional channel settings\n' +
                    '`Wolf.signups [open|close]` - Open or close signups\n' +
                    '`Wolf.next` - Move to the next phase (day/night)\n' +
                    '`Wolf.end` - End the current game (requires confirmation)\n' +
                    '`Wolf.scuff` - Rewind an active game back to signup (requires confirmation)', 
                inline: false 
            },
            { 
                name: '🔧 Channel & Phase Management', 
                value: 
                    '`Wolf.add_channel <n>` - Create additional channel in game category\n' +
                    '`Wolf.create_vote` - 🗳️ Manually create a voting message (voting booth only)\n' +
                    '`Wolf.get_votes` - 📊 Get current vote counts and **who** voted (mod)\n' +
                    '`Wolf.ratio` - Town / Wolf / Neutral seat counts from the saved role list\n' +
                    '`Wolf.wolves_alive` - Count wolves who still have Alive (mods see names; Dead see count only)\n' +
                    '`Wolf.add_in @user` - Add someone to signups without them running `Wolf.in`\n' +
                    '`Wolf.not_voted` - Alive players with no vote yet today (Day 2+ day)\n' +
                '`Wolf.lssv [day]` - 🗳️ Longest standing second vote: final votes in cast order (defaults to today)\n' +
                    '`Wolf.set_voting_booth <channel-name>` - 🗳️ Set voting booth channel for current game\n' +
                    '`Wolf.lockdown` - 🔒 Lock down townsquare and memos (alive players cannot speak)\n' +
                    '`Wolf.lockdown lift` - 🔓 Lift lockdown and restore normal permissions\n' +
                    '`Wolf.populate_journals [number]` - 🧪 Create test journals for testing',
                inline: false 
            },
            { 
                name: '📔 Journal Management', 
                value: 
                    '`Wolf.journal @user` - Create a personal journal for a player\n' +
                    '`Wolf.journal_link` - 🔗 Link existing journals to players\n' +
                    '`Wolf.journal_owner` - 👤 Show journal owner (use in journal)\n' +
                    '`Wolf.journal_unlink` - 🔓 Unlink journal (use in journal)\n' +
                    '`Wolf.journal_assign @user` - 🎯 Assign journal to user (use in journal)\n' +
                    '`Wolf.journal_grant_pin` - 📌 Grant pin permissions for all journals\n' +
                    '`Wolf.balance_journals` - 📚 Balance journals across categories (50 channel limit)',
                inline: false 
            },
            { 
                name: '🎭 Role & Player Management', 
                value: 
                    '`Wolf.roles_list` - 📋 Display all assigned roles for current game\n' +
                    '`Wolf.role_config` - ⚙️ Show role configuration for current game\n' +
                    '`Wolf.kill @player` - 🔫 Removes Alive and adds Dead role\n' +   
                    '`Wolf.inlist` - Show all players signed up (mobile-friendly format)\n' +
                    '`Wolf.dead` - 💀 Show all players currently dead\n' +
                    '`Wolf.unmod @user` or `Wolf.unmod me` - Remove Mod role (super user: anyone; mod: self only)', 
                inline: false 
            },
            { 
                name: '📊 Analysis & Utilities', 
                value: 
                    '`Wolf.server` - 🖥️ Display detailed server information\n' +
                    '`Wolf.ia [channel] <YYYY-MM-DD HH:MM>` - Message count per player since date (EST). BOTH date and channel are optional.\n' +
                    '`Wolf.speed_check` - See messages counts since phase change',
                inline: false 
            },
            { 
                name: '🔄 Recovery & Maintenance', 
                value: 
                    '`Wolf.recovery` - Migration from manual to bot control\n' +
                    '`Wolf.fix_journals` - 🔍 Fix journal permissions\n' +
                    '`Wolf.delete_category <category_name>` - 🧨 Delete a category and ALL channels inside it (requires confirmation)',
                inline: false 
            },
            {
                name: '🧪 Testing Commands',
                value: 
                    '`Wolf.refresh` - Reset server (testing only!)\n' +
                    '`Wolf.archive` - Archive current game data\n' +
                    '`Wolf.archive_local` - 💾 Archive to local JSON file (dev only)\n' +
                    '`Wolf.populate_journals [number]` - 🧪 Create test journals for testing\n' +
                    '`Wolf.sync_members` - 🔄 Sync server members to database', 
                inline: false 
            }
        );
    } else {
        embed.setFooter({ text: 'Note: Some commands are only available to moderators.' });
    }

    await message.reply({ embeds: [embed] });
},

async permsTest(message, args) {   
    
    // Check if user mentioned someone
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
        return message.reply('❌ Please mention a user to create a journal for. Usage: `Wolf.journal @user`');
    }
    // Check if the mentioned user is in the server
    const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
        return message.reply('❌ That user is not in this server.');
    }
    console.log("MEMBER:", JSON.stringify(targetMember));

    const channel = message.mentions.channels.first();
    if (!channel) {
        return message.reply('❌ Please mention a channel');
    }
    else if (channel.guild != message.guild) {
        return message.reply('❌ That channel is not in this server');
    }
    
    await channel.permissionOverwrites.edit(targetMember.id, {
        [PIN_PERMISSION]: true
    });

    return message.reply(`Granted ${targetMember} PinPermissions`);
},

_buildActivityReportEmbeds(sortedPlayers, totalMessages, activityChannel, dateTimeStr, onlyUserId) {
    const title = onlyUserId ? '📊 Your activity (IA)' : '📊 Activity Report';
    const description = onlyUserId
        ? `Your message count since **${dateTimeStr} EST**`
        : `Message count per player since **${dateTimeStr} EST**`;
    const summaryField = {
        name: 'Summary',
        value: `**Total messages**: ${totalMessages}\n**Channel**: ${activityChannel.name}`,
        inline: false,
    };
    const playerCount = sortedPlayers.length;

    const lines =
        sortedPlayers.length > 0
            ? sortedPlayers.map(
                  (player, index) => `${index + 1}. **${player.username}**: ${player.count} messages`
              )
            : ['No messages found from players in the specified time period.'];

    const playerList = lines.join('\n');

    if (playerList.length <= 1024) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .addFields(
                {
                    name: onlyUserId ? 'Your messages' : `Player Activity (${playerCount} players)`,
                    value: playerList,
                },
                summaryField
            )
            .setColor(0x3498DB)
            .setTimestamp();
        return [embed];
    }

    const chunks = [];
    let currentChunk = '';
    let chunkStartIndex = 1;
    let currentIndex = 1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if ((currentChunk + line + '\n').length > 1024) {
            if (currentChunk) {
                chunks.push({
                    text: currentChunk.trim(),
                    startIndex: chunkStartIndex,
                    endIndex: currentIndex - 1,
                });
            }
            currentChunk = line + '\n';
            chunkStartIndex = currentIndex;
        } else {
            currentChunk += line + '\n';
        }
        currentIndex++;
    }
    if (currentChunk) {
        chunks.push({
            text: currentChunk.trim(),
            startIndex: chunkStartIndex,
            endIndex: lines.length,
        });
    }

    return chunks.map((chunk, index) => {
        const chunkTitle = index === 0 ? title : `${title} (continued)`;
        const activityLabel = onlyUserId ? 'Your messages' : 'Player Activity';
        const fieldName =
            chunks.length > 1
                ? `${activityLabel} ${chunk.startIndex}-${chunk.endIndex} (${playerCount} total)`
                : onlyUserId
                  ? 'Your messages'
                  : `Player Activity (${playerCount} players)`;

        const embed = new EmbedBuilder()
            .setTitle(chunkTitle)
            .setColor(0x3498DB)
            .setTimestamp()
            .addFields({ name: fieldName, value: chunk.text });

        if (index === 0) {
            embed.setDescription(description);
            embed.addFields(summaryField);
        }

        return embed;
    });
},

async _replyEmbedsWithinLimit(message, embeds) {
    const maxEmbeds = 10;
    if (embeds.length <= maxEmbeds) {
        return message.reply({ embeds });
    }
    const first = await message.reply({ embeds: embeds.slice(0, maxEmbeds) });
    for (let i = maxEmbeds; i < embeds.length; i += maxEmbeds) {
        await message.channel.send({ embeds: embeds.slice(i, i + maxEmbeds) });
    }
    return first;
},

async handleIA(message, args, opts = {}) {
    const serverId = message.guild.id;
    const onlyUserId = opts && opts.onlyUserId ? opts.onlyUserId : null;

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];

    if (onlyUserId) {
        const selfInGame = await this.db.query(
            'SELECT 1 FROM players WHERE game_id = $1 AND user_id = $2',
            [game.id, onlyUserId]
        );
        if (!selfInGame.rows.length) {
            return message.reply('❌ You are not listed as a player in this game.');
        }
    }

    // Arguments can be:
    // - none: default channel (town square) + default start time (same as before)
    // - one arg: if it's a date => treat as date; otherwise treat as channel name
    // - two+ args: if first arg is a date => treat all as date/time; otherwise first is channel and remaining are date/time
    const looksLikeDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const looksLikeTime = (s) => /^\d{2}:\d{2}$/.test(s);

    let channelArg = null;
    let dateParts = [];

    if (args && args.length) {
        if (args.length === 1) {
            if (looksLikeDate(args[0])) {
                dateParts = [args[0]];
            } else {
                channelArg = args[0];
            }
        } else {
            if (looksLikeDate(args[0])) {
                dateParts = args;
            } else {
                channelArg = args[0];
                dateParts = args.slice(1);
            }
        }
    }

    console.log(dateParts);
    console.log(channelArg);

    // Default start time behavior: if no date provided, use current date in EST/EDT (with the 9:30 AM cutoff)
    if (!dateParts.length) {
        const now = moment.tz("America/New_York");
        const cutoffTime = moment.tz("America/New_York").hour(9).minute(30).second(0).millisecond(0);

        // If it's before 9:30 AM EST today, search from 9:30 AM yesterday
        const searchDate = now.isBefore(cutoffTime)
            ? now.subtract(1, 'day').format('YYYY-MM-DD')
            : now.format('YYYY-MM-DD');

        dateParts = [searchDate, '09:30'];
    } else if (dateParts.length === 1) {
        // Date provided without time => default time to 09:30
        if (!looksLikeDate(dateParts[0])) {
            return message.reply('❌ Invalid date format. Please use: `Wolf.ia [channel] YYYY-MM-DD [HH:MM]` (EST timezone)\nExamples:\n- `Wolf.ia 2024-12-01`\n- `Wolf.ia town-square 2024-12-01 14:30`');
        }
        dateParts = [dateParts[0], '09:30'];
    } else {
        // If time is present, validate it (and ignore any extra parts beyond date+time)
        if (!looksLikeDate(dateParts[0]) || !looksLikeTime(dateParts[1])) {
            return message.reply('❌ Invalid date/time format. Please use: `Wolf.ia [channel] YYYY-MM-DD [HH:MM]` (24-hour format, EST timezone)\nExamples:\n- `Wolf.ia 2024-12-01 14:30`\n- `Wolf.ia town-square 2024-12-01 14:30`');
        }
        dateParts = [dateParts[0], dateParts[1]];
    }

    // Parse the date/time argument
    const dateTimeStr = dateParts.join(' ');
    let utcDate;
    
    try {
        // Parse the input date assuming it's in EST/EDT
        // We need to explicitly specify the timezone to ensure proper conversion
        utcDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm", "America/New_York")
           .utc()
           .toDate();

        // Check if the date is valid
        if (isNaN(utcDate.getTime())) {
            throw new Error('Invalid date');
        }
    } catch (error) {
        return message.reply('❌ Invalid date format. Please use: `Wolf.ia YYYY-MM-DD HH:MM` (24-hour format, EST timezone)\nExample: `Wolf.ia 2024-12-01 14:30`');
    }

    try {
        // Resolve which channel to check for activity
        const resolveActivityChannel = async () => {
            // Default to the game's town square channel
            if (!channelArg) {
                return await this.client.channels.fetch(game.town_square_channel_id);
            }

            console.log("channelArg:", channelArg);

            // Support channel mention (<#id>), raw ID, "#name", or "name"
            const mentionMatch = channelArg.match(/^<#(\d+)>$/);
            const rawIdMatch = channelArg.match(/^\d+$/);
            let channelId = null;
            let channelName = null;

            if (mentionMatch) {
                channelId = mentionMatch[1];
            } else if (rawIdMatch) {
                channelId = channelArg;
            } else {
                channelName = channelArg.replace(/^#/, '').trim().toLowerCase();
            }

            // If we have an ID, fetch directly
            if (channelId) {
                try {
                    return await message.guild.channels.fetch(channelId);
                } catch (e) {
                    return null;
                }
            }

            // Otherwise, search by name (cache first, then fetch all)
            const findByName = () => message.guild.channels.cache.find(ch =>
                ch &&
                typeof ch.name === 'string' &&
                ch.name.toLowerCase() === channelName
            );

            let found = findByName();
            if (found) return found;

            try {
                await message.guild.channels.fetch();
            } catch (e) {
                // ignore; we'll fall back to cache search
            }

            found = findByName();
            return found || null;
        };

        const activityChannel = await resolveActivityChannel();
        console.log("activityChannel:", activityChannel);
        if (!activityChannel) {
            return message.reply(channelArg
                ? `❌ Channel not found: \`${channelArg}\`. Try \`Wolf.ia #channel-name\` or \`Wolf.ia 123456789012345678\`.`
                : '❌ Town square channel not found.');
        }

        // Ensure it's a text-based channel we can read messages from
        if (typeof activityChannel.isTextBased === 'function' && !activityChannel.isTextBased()) {
            return message.reply(`❌ \`${activityChannel.name || channelArg}\` is not a text channel.`);
        }
        if (!activityChannel.messages || typeof activityChannel.messages.fetch !== 'function') {
            return message.reply(`❌ Can't read messages from \`${activityChannel.name || channelArg}\`.`);
        }

        // Get all players in the game (optionally only one user for iaself)
        const playersResult = onlyUserId
            ? await this.db.query(
                'SELECT user_id, username FROM players WHERE game_id = $1 AND user_id = $2',
                [game.id, onlyUserId]
            )
            : await this.db.query(
                'SELECT user_id, username FROM players WHERE game_id = $1',
                [game.id]
            );

        if (playersResult.rows.length === 0) {
            return message.reply('❌ No players found in the current game.');
        }

        // Filter players to only include those with the Alive role
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        if (!aliveRole) {
            return message.reply('❌ Alive role not found. Please use `Wolf.server_roles` to set up roles.');
        }

        // OPTIMIZATION: Fetch all guild members at once instead of individual calls
        try {
            await message.guild.members.fetch();
        } catch (error) {
            console.log('Could not fetch all guild members, falling back to individual fetches');
            // Fallback to original method if bulk fetch fails
            const alivePlayers = [];
            for (const player of playersResult.rows) {
                try {
                    const member = await message.guild.members.fetch(player.user_id);
                    if (member && member.roles.cache.has(aliveRole.id)) {
                        alivePlayers.push(player);
                    }
                } catch (error) {
                    console.error(`Error checking role for player ${player.username}:`, error);
                    // Skip this player if we can't fetch them
                }
            }
            
            if (alivePlayers.length === 0) {
                return message.reply(onlyUserId ? '❌ You do not have the Alive role (or you are not in this game).' : '❌ No alive players found in the current game.');
            }

            // Randomize the player order to prevent role inference
            const shuffledPlayers = [...alivePlayers];
            for (let i = shuffledPlayers.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
            }

            // Initialize message count object
            const messageCounts = {};
            shuffledPlayers.forEach(player => {
                messageCounts[player.user_id] = {
                    username: player.username,
                    count: 0
                };
            });

            // Fetch messages from the selected channel since the specified date
            let allMessages = [];
            let lastMessageId = null;
            
            // Discord API limits us to 100 messages per request, so we need to paginate
            while (true) {
                const options = { limit: 100 };
                if (lastMessageId) {
                    options.before = lastMessageId;
                }

                const messages = await activityChannel.messages.fetch(options);
                
                if (messages.size === 0) break;

                // Filter messages by date and add to our collection
                const filteredMessages = messages.filter(msg => 
                    msg.createdAt >= utcDate && 
                    !msg.author.bot && 
                    messageCounts.hasOwnProperty(msg.author.id)
                );

                allMessages.push(...filteredMessages.values());
                
                // Check if we've gone past our date range
                const oldestMessage = messages.last();
                if (oldestMessage.createdAt < utcDate) {
                    break;
                }

                lastMessageId = oldestMessage.id;
            }

            // Count messages per player
            allMessages.forEach(msg => {
                if (messageCounts[msg.author.id]) {
                    messageCounts[msg.author.id].count++;
                }
            });

            // Sort players by message count (highest first)
            const sortedPlayers = Object.values(messageCounts)
                .sort((a, b) => b.count - a.count);

            const totalMessages = allMessages.length;
            const embeds = this._buildActivityReportEmbeds(
                sortedPlayers,
                totalMessages,
                activityChannel,
                dateTimeStr,
                onlyUserId
            );
            return await this._replyEmbedsWithinLimit(message, embeds);
        }

        // Use cached members for much faster processing
        const alivePlayers = [];
        for (const player of playersResult.rows) {
            const member = message.guild.members.cache.get(player.user_id);
            if (member && member.roles.cache.has(aliveRole.id)) {
                alivePlayers.push(player);
            }
        }

        if (alivePlayers.length === 0) {
            return message.reply(onlyUserId ? '❌ You do not have the Alive role (or you are not in this game).' : '❌ No alive players found in the current game.');
        }

        // Randomize the player order to prevent role inference
        const shuffledPlayers = [...alivePlayers];
        for (let i = shuffledPlayers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
        }

        // Initialize message count object
        const messageCounts = {};
        shuffledPlayers.forEach(player => {
            messageCounts[player.user_id] = {
                username: player.username,
                count: 0
            };
        });

        // Fetch messages from the selected channel since the specified date
        let allMessages = [];
        let lastMessageId = null;
        
        // Discord API limits us to 100 messages per request, so we need to paginate
        while (true) {
            const options = { limit: 100 };
            if (lastMessageId) {
                options.before = lastMessageId;
            }

            const messages = await activityChannel.messages.fetch(options);
            
            if (messages.size === 0) break;

            // Filter messages by date and add to our collection
            const filteredMessages = messages.filter(msg => 
                msg.createdAt >= utcDate && 
                !msg.author.bot && 
                messageCounts.hasOwnProperty(msg.author.id)
            );

            allMessages.push(...filteredMessages.values());
            
            // Check if we've gone past our date range
            const oldestMessage = messages.last();
            if (oldestMessage.createdAt < utcDate) {
                break;
            }

            lastMessageId = oldestMessage.id;
        }

        // Count messages per player
        allMessages.forEach(msg => {
            if (messageCounts[msg.author.id]) {
                messageCounts[msg.author.id].count++;
            }
        });

        // Sort players by message count (highest first)
        const sortedPlayers = Object.values(messageCounts)
            .sort((a, b) => b.count - a.count);

        const totalMessages = allMessages.length;
        const embeds = this._buildActivityReportEmbeds(
            sortedPlayers,
            totalMessages,
            activityChannel,
            dateTimeStr,
            onlyUserId
        );
        return await this._replyEmbedsWithinLimit(message, embeds);

    } catch (error) {
        console.error('Error fetching message activity:', error);
        await message.reply('❌ An error occurred while fetching message activity. The date range might be too large or the channel might be inaccessible.');
    }
},

async handleServer(message) {
    const serverId = message.guild.id;
    const serverName = message.guild.name;
    const memberCount = message.guild.memberCount;
    console.log(`Fetching server info for ${serverName} (${serverId}) with ${memberCount} members`);

    try {
        // Get server configuration
        const configResult = await this.db.query(
            'SELECT * FROM server_configs WHERE server_id = $1',
            [serverId]
        );

        let serverConfig = null;
        if (configResult.rows.length > 0) {
            serverConfig = configResult.rows[0];
        }

        // Get current active game
        const activeGameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3) ORDER BY id DESC LIMIT 1',
            [serverId, 'signup', 'active']
        );

        let activeGame = null;
        let playerCount = 0;
        let aliveCount = 0;
        let gameChannels = [];

        if (activeGameResult.rows.length > 0) {
            activeGame = activeGameResult.rows[0];
            
            // Get player counts
            const playersResult = await this.db.query(
                'SELECT COUNT(*) as total FROM players WHERE game_id = $1',
                [activeGame.id]
            );
            playerCount = parseInt(playersResult.rows[0].total);

            // Count alive players by checking Discord roles
            const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
            if (aliveRole) {
                const allPlayers = await this.db.query(
                    'SELECT user_id FROM players WHERE game_id = $1',
                    [activeGame.id]
                );

                try {
                    await message.guild.members.fetch();
                } catch (error) {
                    console.log('Could not fetch all guild members, falling back to individual fetches');
                    // Fallback to original method if bulk fetch fails
                    for (const player of allPlayers.rows) {
                        try {
                            const member = await message.guild.members.fetch(player.user_id);
                            if (member && member.roles.cache.has(aliveRole.id)) {
                                aliveCount++;
                            }
                        } catch (error) {
                            // Member might have left the server
                            continue;
                        }
                    }
                }

                // Use cached members for much faster processing
                for (const player of allPlayers.rows) {
                    const member = message.guild.members.cache.get(player.user_id);
                    if (member && member.roles.cache.has(aliveRole.id)) {
                        aliveCount++;
                    }
                }
            }

            // Get additional game channels
            const additionalChannelsResult = await this.db.query(
                'SELECT channel_id FROM game_channels WHERE game_id = $1',
                [activeGame.id]
            );
            gameChannels = additionalChannelsResult.rows.map(row => row.channel_id);
        }

        // Get total games played on server
        const totalGamesResult = await this.db.query(
            'SELECT COUNT(*) as total FROM games WHERE server_id = $1',
            [serverId]
        );
        const totalGames = parseInt(totalGamesResult.rows[0].total);

        // Get role information
        const roles = {
            mod: message.guild.roles.cache.find(r => r.name === 'Mod'),
            spectator: message.guild.roles.cache.find(r => r.name === 'Spectator'),
            signedUp: message.guild.roles.cache.find(r => r.name === 'Signed Up'),
            alive: message.guild.roles.cache.find(r => r.name === 'Alive'),
            dead: message.guild.roles.cache.find(r => r.name === 'Dead')
        };

        // Build the embed
        const embed = new EmbedBuilder()
            .setTitle(`🖥️ Server Information: ${serverName}`)
            .setColor(0x3498DB)
            .setTimestamp()
            .setFooter({ text: `Server ID: ${serverId}` });

        // Get channel counts (includes queued-to-create from DB for accurate projection)
        const capacity = await this.getServerChannelCapacity(serverId, message.guild);
        const channelUsagePercentage = ((capacity.currentChannelsCount / capacity.channelLimit) * 100).toFixed(1);
        const projectedUsagePercentage = ((capacity.projectedTotal / capacity.channelLimit) * 100).toFixed(1);
        
        // Basic server info
        embed.addFields(
            {
                name: '📊 Basic Info',
                value:
                    `**Members:** ${memberCount}\n` +
                    `**Total Games:** ${totalGames}\n` +
                    `**Channels (now):** ${capacity.currentChannelsCount}/${capacity.channelLimit} (${channelUsagePercentage}%)\n` +
                    `**Queued (DB):** ${capacity.pendingToCreateCount}\n` +
                    `**Projected:** ${capacity.projectedTotal}/${capacity.channelLimit} (${projectedUsagePercentage}%)` +
                    (capacity.isWithinLimitProjected ? '' : `\n⚠️ **Over limit by:** ${Math.abs(capacity.remainingProjected)}`),
                inline: true
            }
        );

        // Server configuration
        if (serverConfig) {
            embed.addFields({
                name: '⚙️ Configuration',
                value: `**Prefix:** ${serverConfig.game_prefix}\n**Game Counter:** ${serverConfig.game_counter}\n**Game Name:** ${serverConfig.game_name || 'Not set'}`,
                inline: true
            });
        } else {
            embed.addFields({
                name: '⚙️ Configuration',
                value: '❌ Not configured\nRun `Wolf.setup` first',
                inline: true
            });
        }

        // Role status
        const roleStatus = Object.entries(roles)
            .map(([roleName, role]) => `${role ? '✅' : '❌'} ${roleName.charAt(0).toUpperCase() + roleName.slice(1)}`)
            .join('\n');

        embed.addFields({
            name: '🎭 Role Status',
            value: roleStatus,
            inline: true
        });

        // Active game information
        if (activeGame) {
            let gameStatus = `**Status:** ${activeGame.status.charAt(0).toUpperCase() + activeGame.status.slice(1)}`;
            if (activeGame.status === 'active') {
                gameStatus += `\n**Phase:** ${activeGame.day_phase.charAt(0).toUpperCase() + activeGame.day_phase.slice(1)} ${activeGame.day_number}`;
            }
            gameStatus += `\n**Players:** ${playerCount}`;
            if (activeGame.status === 'active') {
                gameStatus += `\n**Alive:** ${aliveCount}`;
            }

            embed.addFields({
                name: `🎮 Active Game: ${activeGame.game_name ? `${activeGame.game_name} ` : ''}Game ${activeGame.game_number}`,
                value: gameStatus,
                inline: false
            });

            // Game channels
            if (activeGame.status === 'active') {
                const channels = [];
                if (activeGame.town_square_channel_id) channels.push(`<#${activeGame.town_square_channel_id}>`);
                if (activeGame.voting_booth_channel_id) channels.push(`<#${activeGame.voting_booth_channel_id}>`);
                if (activeGame.wolf_chat_channel_id) channels.push(`<#${activeGame.wolf_chat_channel_id}>`);
                if (activeGame.signup_channel_id) channels.push(`<#${activeGame.signup_channel_id}> (Dead Chat)`);
                if (activeGame.memos_channel_id) channels.push(`<#${activeGame.memos_channel_id}>`);
                if (activeGame.results_channel_id) channels.push(`<#${activeGame.results_channel_id}>`);
                
                // Add additional channels
                for (const channelId of gameChannels) {
                    try {
                        const channel = await message.guild.channels.fetch(channelId);
                        if (channel) {
                            channels.push(`<#${channelId}>`);
                        }
                    } catch (error) {
                        channels.push(`❌ Deleted channel (${channelId})`);
                    }
                }

                if (channels.length > 0) {
                    embed.addFields({
                        name: '📢 Game Channels',
                        value: channels.join('\n'),
                        inline: false
                    });
                }
            }
        } else {
            embed.addFields({
                name: '🎮 Active Game',
                value: 'No active game',
                inline: false
            });
        }

        // Database connectivity test
        try {
            await this.db.query('SELECT 1');
            embed.addFields({
                name: '🗄️ Database',
                value: '✅ Connected',
                inline: true
            });
        } catch (error) {
            embed.addFields({
                name: '🗄️ Database',
                value: '❌ Connection Error',
                inline: true
            });
        }

        // Bot information
        embed.addFields({
            name: '🤖 Bot Info',
            value: `**Prefix:** ${this.prefix}\n**Uptime:** ${process.uptime().toFixed(0)}s`,
            inline: true
        });

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error getting server information:', error);
        await message.reply('❌ An error occurred while retrieving server information.');
    }
},

calculateSimilarity(str1, str2) {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
    
    const matrix = [];
    
    // Create matrix
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    // Fill matrix
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    const distance = matrix[str2.length][str1.length];
    const maxLength = Math.max(str1.length, str2.length);
    
    // Return similarity as percentage (higher = more similar)
    return ((maxLength - distance) / maxLength) * 100;
},

async handleMeme(message) {
    try {
        const username = message.author.username.toLowerCase();
        const displayName = message.member ? message.member.displayName.toLowerCase() : '';
        
        // Check if the user has "geese" in their username or display name
        if (username.includes('geese') || displayName.includes('geese')) {
            await message.reply('And especially you! You\'re not getting anything from me');
        } else {
            await message.reply('Are you kidding me? After all the vitriol you put me through, you expect me to just give you a little funny quip or joke? I\'ll give you something to laugh about if youre not careful');
        }
    } catch (error) {
        console.error('Error handling meme command:', error);
        await message.reply('❌ An error occurred while processing the meme command.');
    }
},

async handleFeedback(message, args) {
    try {
        // Check if feedback text was provided
        if (args.length === 0) {
            await message.reply('Please provide feedback text. Usage: `' + this.prefix + 'feedback <your feedback message>`');
            return;
        }

        const feedbackText = args.join(' ').trim();
        
        // Validate feedback length
        if (feedbackText.length > 2000) {
            await message.reply('Feedback is too long. Please keep it under 2000 characters.');
            return;
        }

        if (feedbackText.length < 3) {
            await message.reply('Feedback is too short. Please provide more details.');
            return;
        }

        // Get user information
        const userId = message.author.id;
        const displayName = message.member?.displayName || message.author.username;
        const serverId = message.guild.id;

        // Insert feedback into database using parameterized query to prevent SQL injection
        const query = `
            INSERT INTO feedback (user_id, display_name, feedback_text, server_id) 
            VALUES ($1, $2, $3, $4) 
            RETURNING id, created_at
        `;
        
        const result = await this.db.query(query, [userId, displayName, feedbackText, serverId]);
        
        if (result.rows.length > 0) {
            const feedbackId = result.rows[0].id;
            const createdAt = result.rows[0].created_at;
            
            // Send confirmation message
            const embed = new EmbedBuilder()
                .setTitle('✅ Feedback Submitted')
                .setDescription(`Thank you for your feedback, ${displayName}!`)
                .setColor(0x00AE86)
                .setFooter({ text: 'Your feedback has been recorded and will be reviewed by that lazy bum Stinky.' });

            await message.reply({ embeds: [embed] });
            
            console.log(`Feedback submitted by ${displayName} (${userId}) in server ${serverId}: ${feedbackText.substring(0, 100)}...`);
        } else {
            throw new Error('Failed to insert feedback into database');
        }

    } catch (error) {
        console.error('Error handling feedback command:', error);
        await message.reply('Sorry, there was an error submitting your feedback. Please try again later.');
    }
},

};
