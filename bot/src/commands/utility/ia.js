const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

module.exports = {
    name: 'ia',
    description: 'Message count per player since date (EST)',
    playerCommand: false,
    async execute(message, args, client, db) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Check if date/time argument is provided
        let argumentsArray = args
        if (!argumentsArray.length) {
            // Use current date in EST/EDT timezone instead of UTC to avoid next-day issues
            const now = moment.tz("America/New_York");
            const cutoffTime = moment.tz("America/New_York").hour(9).minute(30).second(0).millisecond(0);

            // If it's before 9:30 AM EST today, search from 9:30 AM yesterday
            let searchDate;
            if (now.isBefore(cutoffTime)) {
                searchDate = now.subtract(1, 'day').format('YYYY-MM-DD');
            } else {
                searchDate = now.format('YYYY-MM-DD');
            }

            argumentsArray = [searchDate, '09:30'];
        }

        // Parse the date/time argument
        const dateTimeStr = argumentsArray.join(' ');
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
            // Get the town square channel
            const townSquareChannel = await client.channels.fetch(game.town_square_channel_id);
            if (!townSquareChannel) {
                return message.reply('❌ Town square channel not found.');
            }

            // Get all players in the game
            const playersResult = await db.query(
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
                    return message.reply('❌ No alive players found in the current game.');
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

                // Fetch messages from the town square since the specified date
                let allMessages = [];
                let lastMessageId = null;

                // Discord API limits us to 100 messages per request, so we need to paginate
                while (true) {
                    const options = { limit: 100 };
                    if (lastMessageId) {
                        options.before = lastMessageId;
                    }

                    const messages = await townSquareChannel.messages.fetch(options);

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

                // Create the response embed
                const totalMessages = allMessages.length;
                const playerList = sortedPlayers.length > 0
                    ? sortedPlayers.map((player, index) =>
                        `${index + 1}. **${player.username}**: ${player.count} messages`
                    ).join('\n')
                    : 'No messages found from players in the specified time period.';

                const embed = new EmbedBuilder()
                    .setTitle('📊 Town Square Activity Report')
                    .setDescription(`Message count per player since **${dateTimeStr} EST**`)
                    .addFields(
                        { name: `Player Activity (${sortedPlayers.length} players)`, value: playerList },
                        { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${townSquareChannel.name}`, inline: false }
                    )
                    .setColor(0x3498DB)
                    .setTimestamp();

                return await message.reply({ embeds: [embed] });
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
                return message.reply('❌ No alive players found in the current game.');
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

            // Fetch messages from the town square since the specified date
            let allMessages = [];
            let lastMessageId = null;

            // Discord API limits us to 100 messages per request, so we need to paginate
            while (true) {
                const options = { limit: 100 };
                if (lastMessageId) {
                    options.before = lastMessageId;
                }

                const messages = await townSquareChannel.messages.fetch(options);

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

            // Create the response embed
            const totalMessages = allMessages.length;
            const playerList = sortedPlayers.length > 0
                ? sortedPlayers.map((player, index) =>
                    `${index + 1}. **${player.username}**: ${player.count} messages`
                ).join('\n')
                : 'No messages found from players in the specified time period.';

            const embed = new EmbedBuilder()
                .setTitle('📊 Town Square Activity Report')
                .setDescription(`Message count per player since **${dateTimeStr} EST**`)
                .addFields(
                    { name: `Player Activity (${sortedPlayers.length} players)`, value: playerList },
                    { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${townSquareChannel.name}`, inline: false }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching message activity:', error);
            await message.reply('❌ An error occurred while fetching message activity. The date range might be too large or the channel might be inaccessible.');
        }
    }
};
