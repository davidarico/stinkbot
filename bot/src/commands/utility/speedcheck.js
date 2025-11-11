const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

module.exports = {
    name: 'speedcheck',
    description: 'Show message activity for alive players since current phase started',
    playerCommand: false,
    async execute(message, args, client, db) {
        const serverId = message.guild.id;

        // Get active game - TIMESTAMPTZ columns are automatically returned in UTC
        const gameResult = await db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        if (!game.phase_change_at) {
            return message.reply('❌ No phase change time recorded for this game.');
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

                // Use phase_change_at as the start time (TIMESTAMPTZ is automatically UTC)
                const phaseChangeDate = new Date(game.phase_change_at);

                // Debug logging
                console.log(`Speed check debug:
                    - Phase change at (raw from DB): ${game.phase_change_at}
                    - Phase change as Date: ${phaseChangeDate.toISOString()}
                    - Phase change in EST: ${moment.utc(game.phase_change_at).tz("America/New_York").format('YYYY-MM-DD HH:mm:ss')}
                    - Current time: ${new Date().toISOString()}
                    - Time difference: ${(new Date() - phaseChangeDate) / (1000 * 60)} minutes`);

                // Fetch messages from the town square since the phase change
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
                        msg.createdAt >= phaseChangeDate &&
                        !msg.author.bot &&
                        messageCounts.hasOwnProperty(msg.author.id)
                    );

                    allMessages.push(...filteredMessages.values());

                    // Check if we've gone past our date range
                    const oldestMessage = messages.last();
                    if (oldestMessage.createdAt < phaseChangeDate) {
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

                // Convert UTC time to EST for display - TIMESTAMPTZ is already UTC
                const estTime = moment.utc(game.phase_change_at).tz("America/New_York").format('YYYY-MM-DD HH:mm:ss');

                // Create the response embed
                const totalMessages = allMessages.length;
                const playerList = sortedPlayers.length > 0
                    ? sortedPlayers.map((player, index) =>
                        `${index + 1}. **${player.username}**: ${player.count} messages`
                    ).join('\n')
                    : `No messages found from alive players since phase change.\n\n**Debug info:**\n• Phase started: ${estTime} EST\n• Current time: ${moment.utc().tz("America/New_York").format('YYYY-MM-DD HH:mm:ss')} EST\n• Messages need to be sent AFTER the phase start time`;

                const currentPhase = game.day_phase === 'day' ? '🌞 Day' : '🌙 Night';

                const embed = new EmbedBuilder()
                    .setTitle('⚡ Speed Check - Current Phase Activity')
                    .setDescription(`Message count per alive player since **${currentPhase} ${game.day_number}** started\n\n**Phase started:** ${estTime} EST`)
                    .addFields(
                        { name: `Alive Player Activity (${sortedPlayers.length} players)`, value: playerList },
                        { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${townSquareChannel.name}`, inline: false }
                    )
                    .setColor(game.day_phase === 'day' ? 0xF1C40F : 0x2C3E50)
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

            // Use phase_change_at as the start time (TIMESTAMPTZ is automatically UTC)
            const phaseChangeDate = new Date(game.phase_change_at);

            // Debug logging
            console.log(`Speed check debug:
                - Phase change at (raw from DB): ${game.phase_change_at}
                - Phase change as Date: ${phaseChangeDate.toISOString()}
                - Phase change in EST: ${moment.utc(game.phase_change_at).tz("America/New_York").format('YYYY-MM-DD HH:mm:ss')}
                - Current time: ${new Date().toISOString()}
                - Time difference: ${(new Date() - phaseChangeDate) / (1000 * 60)} minutes`);

            // Fetch messages from the town square since the phase change
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
                    msg.createdAt >= phaseChangeDate &&
                    !msg.author.bot &&
                    messageCounts.hasOwnProperty(msg.author.id)
                );

                allMessages.push(...filteredMessages.values());

                // Check if we've gone past our date range
                const oldestMessage = messages.last();
                if (oldestMessage.createdAt < phaseChangeDate) {
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

            // Convert UTC time to EST for display - TIMESTAMPTZ is already UTC
            const estTime = moment.utc(game.phase_change_at).tz("America/New_York").format('YYYY-MM-DD HH:mm:ss');

            // Create the response embed
            const totalMessages = allMessages.length;
            const playerList = sortedPlayers.length > 0
                ? sortedPlayers.map((player, index) =>
                    `${index + 1}. **${player.username}**: ${player.count} messages`
                ).join('\n')
                : `No messages found from alive players since phase change.\n\n**Debug info:**\n• Phase started: ${estTime} EST\n• Current time: ${moment.utc().tz("America/New_York").format('YYYY-MM-DD HH:mm:ss')} EST\n• Messages need to be sent AFTER the phase start time`;

            const currentPhase = game.day_phase === 'day' ? '🌞 Day' : '🌙 Night';

            const embed = new EmbedBuilder()
                .setTitle('⚡ Speed Check - Current Phase Activity')
                .setDescription(`Message count per alive player since **${currentPhase} ${game.day_number}** started\n\n**Phase started:** ${estTime} EST`)
                .addFields(
                    { name: `Alive Player Activity (${sortedPlayers.length} players)`, value: playerList },
                    { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${townSquareChannel.name}`, inline: false }
                )
                .setColor(game.day_phase === 'day' ? 0xF1C40F : 0x2C3E50)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching speed check activity:', error);
            await message.reply('❌ An error occurred while fetching speed check activity.');
        }
    }
};
