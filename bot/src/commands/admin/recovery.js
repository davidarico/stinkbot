const { EmbedBuilder, ChannelType } = require('discord.js');

module.exports = {
    name: 'recovery',
    playerCommand: false,
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        try {
            // Step 1: Check if setup was done
            const embed1 = new EmbedBuilder()
                .setTitle('🔧 Recovery Mode - Server Setup Check')
                .setDescription('Recovery mode will help you migrate from manual game management back to the bot.\n\n**Important:** Have you already run `Wolf.setup` to configure this server?')
                .addFields(
                    { name: 'Required', value: 'You must have run `Wolf.setup` first before using recovery mode.', inline: false },
                    { name: 'Response', value: 'Type `yes` if you have run setup, or `cancel` to exit and run setup first.', inline: false }
                )
                .setColor(0xF39C12);

            await message.reply({ embeds: [embed1] });

            const setupResponse = await awaitResponse(message, ['yes', 'cancel'], 60000);
            if (!setupResponse || setupResponse === 'cancel') {
                return message.reply('❌ Recovery cancelled. Please run `Wolf.setup` first, then try recovery again.');
            }

            // Verify setup exists in database
            const configResult = await bot.db.query(
                'SELECT * FROM server_configs WHERE server_id = $1',
                [serverId]
            );

            if (!configResult.rows.length) {
                return message.reply('❌ No server configuration found. Please run `Wolf.setup` first.');
            }

            const config = configResult.rows[0];

            // Step 2: Ask for game category
            const embed2 = new EmbedBuilder()
                .setTitle('🎮 Recovery Mode - Game Category')
                .setDescription('What is the name of the current game\'s category?\n\nPlease type the exact name of the category channel.')
                .setColor(0x3498DB);

            await message.reply({ embeds: [embed2] });

            const categoryName = await awaitTextResponse(message, 60000);
            if (!categoryName) {
                return message.reply('❌ Recovery timed out. Please try again.');
            }

            // Find the category
            const category = message.guild.channels.cache.find(c =>
                c.type === ChannelType.GuildCategory &&
                c.name.toLowerCase() === categoryName.toLowerCase()
            );

            if (!category) {
                return message.reply(`❌ Could not find category "${categoryName}". Please check the name and try again.`);
            }

            // Step 3: Ask about game status
            const embed3 = new EmbedBuilder()
                .setTitle('📊 Recovery Mode - Game Status')
                .setDescription('What is the current status of the game?')
                .addFields(
                    { name: 'Options', value: '• Type `signup` if the game is still in signups\n• Type `active` if the game has started', inline: false }
                )
                .setColor(0x9B59B6);

            await message.reply({ embeds: [embed3] });

            const gameStatus = await awaitResponse(message, ['signup', 'active'], 60000);
            if (!gameStatus) {
                return message.reply('❌ Recovery timed out. Please try again.');
            }

            // Step 4: Find players and confirm
            let players = [];
            if (gameStatus === 'signup') {
                const signedUpRole = message.guild.roles.cache.find(r => r.name === 'Signed Up');
                if (signedUpRole) {
                    // Ensure we have all members cached
                    await message.guild.members.fetch();
                    players = signedUpRole.members.map(member => ({
                        user_id: member.id,
                        username: member.displayName,
                        status: 'alive'
                    }));
                }
            } else {
                // Ensure we have all members cached before checking roles
                await message.guild.members.fetch();

                const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
                const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');

                console.log(aliveRole.members)

                if (aliveRole) {
                    aliveRole.members.forEach(member => {
                        players.push({
                            user_id: member.id,
                            username: member.displayName,
                            status: 'alive'
                        });
                    });
                }

                if (deadRole) {
                    deadRole.members.forEach(member => {
                        players.push({
                            user_id: member.id,
                            username: member.displayName,
                            status: 'dead'
                        });
                    });
                }
            }

            if (players.length === 0) {
                return message.reply('❌ No players found with the appropriate roles. Please assign roles first.');
            }

            const playerList = players.map((p, i) =>
                `${i + 1}. ${p.username} ${gameStatus === 'active' ? `(${p.status})` : ''}`
            ).join('\n');

            const embed4 = new EmbedBuilder()
                .setTitle('👥 Recovery Mode - Player Confirmation')
                .setDescription('Here are the players found in the game:')
                .addFields({ name: `Players (${players.length})`, value: playerList })
                .setFooter({ text: 'Type "yes" to confirm or "no" to cancel' })
                .setColor(0x00AE86);

            await message.reply({ embeds: [embed4] });

            const playerConfirm = await awaitResponse(message, ['yes', 'no'], 60000);
            if (!playerConfirm || playerConfirm === 'no') {
                return message.reply('❌ Recovery cancelled. Please adjust player roles and try again.');
            }

            // Step 5: If game is active, ask about day/night and day number
            let dayPhase = 'night';
            let dayNumber = 1;

            if (gameStatus === 'active') {
                const embed5a = new EmbedBuilder()
                    .setTitle('🌙🌞 Recovery Mode - Game Phase')
                    .setDescription('What phase is the game currently in?')
                    .addFields(
                        { name: 'Options', value: '• Type `day` if it\'s currently day time\n• Type `night` if it\'s currently night time', inline: false }
                    )
                    .setColor(0xF1C40F);

                await message.reply({ embeds: [embed5a] });

                dayPhase = await awaitResponse(message, ['day', 'night'], 60000);
                if (!dayPhase) {
                    return message.reply('❌ Recovery timed out. Please try again.');
                }

                const embed5b = new EmbedBuilder()
                    .setTitle('📅 Recovery Mode - Day Number')
                    .setDescription('What day number is the game currently on?\n\nPlease type a number (e.g., 1, 2, 3...)')
                    .setColor(0xE67E22);

                await message.reply({ embeds: [embed5b] });

                const dayNumberStr = await awaitTextResponse(message, 60000);
                if (!dayNumberStr) {
                    return message.reply('❌ Recovery timed out. Please try again.');
                }

                dayNumber = parseInt(dayNumberStr);
                if (isNaN(dayNumber) || dayNumber < 1) {
                    return message.reply('❌ Invalid day number. Please try again with a valid number.');
                }
            }

            // Step 6: Ask for channel names
            const channels = {};

            if (gameStatus === 'signup') {
                // Only ask for signup channel
                const embed6 = new EmbedBuilder()
                    .setTitle('📺 Recovery Mode - Signup Channel')
                    .setDescription('What is the name of the signup channel?\n\nPlease type the exact channel name (without #).')
                    .setColor(0x8E44AD);

                await message.reply({ embeds: [embed6] });

                const signupChannelName = await awaitTextResponse(message, 60000);
                if (!signupChannelName) {
                    return message.reply('❌ Recovery timed out. Please try again.');
                }

                const signupChannel = message.guild.channels.cache.find(c =>
                    c.name.toLowerCase() === signupChannelName.toLowerCase() &&
                    c.parent?.id === category.id
                );

                if (!signupChannel) {
                    return message.reply(`❌ Could not find channel "${signupChannelName}" in the game category.`);
                }

                channels.signup_channel_id = signupChannel.id;
            } else {
                // Ask for all game channels
                const coreChannels = [
                    { key: 'town_square_channel_id', name: 'Town Square', description: 'the main discussion channel' },
                    { key: 'voting_booth_channel_id', name: 'Voting Booth', description: 'where players exercise their right to hang innocents' },
                    { key: 'wolf_chat_channel_id', name: 'Wolf Chat', description: 'the liars den' },
                    { key: 'memos_channel_id', name: 'Memos', description: 'the memos/notes channel' },
                    { key: 'results_channel_id', name: 'Results', description: 'where mods ruin people\'s day' },
                    { key: 'signup_channel_id', name: 'Dead Chat', description: 'the losers chat' }
                ];

                for (const channelInfo of coreChannels) {
                    const embed6 = new EmbedBuilder()
                        .setTitle(`📺 Recovery Mode - ${channelInfo.name}`)
                        .setDescription(`What is the name of ${channelInfo.description}?\n\nPlease type the exact channel name (without #).`)
                        .setColor(0x8E44AD);

                    await message.reply({ embeds: [embed6] });

                    const channelName = await awaitTextResponse(message, 60000);
                    if (!channelName) {
                        return message.reply('❌ Recovery timed out. Please try again.');
                    }

                    const channel = message.guild.channels.cache.find(c =>
                        c.name.toLowerCase() === channelName.toLowerCase() &&
                        c.parent?.id === category.id
                    );

                    if (!channel) {
                        return message.reply(`❌ Could not find channel "${channelName}" in the game category.`);
                    }

                    channels[channelInfo.key] = channel.id;
                }

                // Ask for additional channels
                const additionalChannels = [];
                while (true) {
                    const embedExtra = new EmbedBuilder()
                        .setTitle('➕ Recovery Mode - Additional Channels')
                        .setDescription('Are there any additional custom channels in the game category?\n\nType the channel name (without #) to add it, or type `done` when finished.')
                        .setColor(0x95A5A6);

                    await message.reply({ embeds: [embedExtra] });

                    const extraChannelName = await awaitTextResponse(message, 60000);
                    if (!extraChannelName || extraChannelName.toLowerCase() === 'done') {
                        break;
                    }

                    const extraChannel = message.guild.channels.cache.find(c =>
                        c.name.toLowerCase() === extraChannelName.toLowerCase() &&
                        c.parent?.id === category.id
                    );

                    if (!extraChannel) {
                        await message.reply(`❌ Could not find channel "${extraChannelName}" in the game category. Skipping...`);
                        continue;
                    }

                    additionalChannels.push({
                        channel_id: extraChannel.id,
                        channel_name: extraChannel.name
                    });

                    await message.reply(`✅ Added "${extraChannel.name}" to additional channels.`);
                }

                channels.additionalChannels = additionalChannels;
            }

            // Step 7: Show summary and confirm
            const summaryEmbed = new EmbedBuilder()
                .setTitle('📋 Recovery Mode - Final Confirmation')
                .setDescription('Please review all the information before we save it to the database:')
                .addFields(
                    { name: 'Game Category', value: category.name, inline: true },
                    { name: 'Game Status', value: gameStatus === 'signup' ? 'Signups' : 'Active', inline: true },
                    { name: 'Players', value: `${players.length} players found`, inline: true }
                );

            if (gameStatus === 'active') {
                summaryEmbed.addFields(
                    { name: 'Current Phase', value: `${dayPhase} ${dayNumber}`, inline: true }
                );
            }

            // Add channel information
            let channelInfo = '';
            if (gameStatus === 'signup') {
                const signupChannel = message.guild.channels.cache.get(channels.signup_channel_id);
                channelInfo = `• Signup: ${signupChannel.name}`;
            } else {
                const channelNames = Object.entries(channels)
                    .filter(([key]) => key !== 'additionalChannels')
                    .map(([key, channelId]) => {
                        const channel = message.guild.channels.cache.get(channelId);
                        const displayName = key.replace('_channel_id', '').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                        return `• ${displayName}: ${channel.name}`;
                    }).join('\n');

                if (channels.additionalChannels && channels.additionalChannels.length > 0) {
                    channelInfo += '\n• Additional: ' + channels.additionalChannels.map(c => c.channel_name).join(', ');
                }
            }

            summaryEmbed.addFields({ name: 'Channels', value: channelInfo, inline: false });
            summaryEmbed.setFooter({ text: 'Type "confirm" to save this data or "cancel" to abort' });
            summaryEmbed.setColor(0x2ECC71);

            await message.reply({ embeds: [summaryEmbed] });

            const finalConfirm = await awaitResponse(message, ['confirm', 'cancel'], 60000);
            if (!finalConfirm || finalConfirm === 'cancel') {
                return message.reply('❌ Recovery cancelled. No data was saved.');
            }

            // Step 8: Save to database
            const gameId = await saveRecoveryData(bot, serverId, config, {
                category_id: category.id,
                game_status: gameStatus,
                day_phase: dayPhase,
                day_number: dayNumber,
                players: players,
                channels: channels
            });

            // If game is active and it's day time, create voting message
            if (gameStatus === 'active' && dayPhase === 'day' && channels.voting_booth_channel_id) {
                try {
                    const votingChannel = await bot.client.channels.fetch(channels.voting_booth_channel_id);
                    await bot.createVotingMessage(gameId, votingChannel);
                } catch (error) {
                    console.error('Error creating voting message during recovery:', error);
                }
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Recovery Complete!')
                .setDescription('All data has been successfully saved to the database. The bot is now ready to manage your game.')
                .addFields(
                    { name: 'What\'s Next?', value: '• The bot will now track your game state\n• You can use normal bot commands\n• Game data is synchronized with Discord roles' + (gameStatus === 'active' && dayPhase === 'day' ? '\n• Voting message has been posted to the voting booth' : ''), inline: false }
                )
                .setColor(0x00AE86);

            await message.reply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error in recovery mode:', error);
            await message.reply('❌ An error occurred during recovery. Please try again.');
        }
    }
};

// Helper functions
async function awaitResponse(message, validResponses, timeout = 30000) {
    const filter = (m) => m.author.id === message.author.id &&
        validResponses.includes(m.content.toLowerCase());

    try {
        const collected = await message.channel.awaitMessages({
            filter,
            max: 1,
            time: timeout,
            errors: ['time']
        });
        return collected.first().content.toLowerCase();
    } catch (error) {
        return null;
    }
}

async function awaitTextResponse(message, timeout = 30000) {
    const filter = (m) => m.author.id === message.author.id && !m.author.bot;

    try {
        const collected = await message.channel.awaitMessages({
            filter,
            max: 1,
            time: timeout,
            errors: ['time']
        });
        return collected.first().content.trim();
    } catch (error) {
        return null;
    }
}

async function saveRecoveryData(bot, serverId, config, recoveryData) {
    try {
        // First, check if there's already an active game and end it
        await bot.db.query(
            'UPDATE games SET status = $1 WHERE server_id = $2 AND status IN ($3, $4)',
            ['ended', serverId, 'signup', 'active']
        );

        // Create new game entry
        const gameResult = await bot.db.query(
            `INSERT INTO games (
                    server_id, game_number, game_name, category_id, status, day_phase, day_number,
                    signup_channel_id, town_square_channel_id, wolf_chat_channel_id,
                    memos_channel_id, results_channel_id, voting_booth_channel_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING id`,
            [
                serverId,
                config.game_counter - 1, // Use current counter minus 1 since it was already incremented
                config.game_name,
                recoveryData.category_id,
                recoveryData.game_status,
                recoveryData.day_phase,
                recoveryData.day_number,
                recoveryData.channels.signup_channel_id || null,
                recoveryData.channels.town_square_channel_id || null,
                recoveryData.channels.wolf_chat_channel_id || null,
                recoveryData.channels.memos_channel_id || null,
                recoveryData.channels.results_channel_id || null,
                recoveryData.channels.voting_booth_channel_id || null
            ]
        );

        const gameId = gameResult.rows[0].id;

        // Insert players
        for (const player of recoveryData.players) {
            await bot.db.query(
                'INSERT INTO players (game_id, user_id, username, status) VALUES ($1, $2, $3, $4)',
                [gameId, player.user_id, player.username, player.status]
            );
        }

        // Insert additional channels if any
        if (recoveryData.channels.additionalChannels) {
            for (const channel of recoveryData.channels.additionalChannels) {
                await bot.db.query(
                    'INSERT INTO game_channels (game_id, channel_id, channel_name) VALUES ($1, $2, $3)',
                    [gameId, channel.channel_id, channel.channel_name]
                );
            }
        }

        console.log(`Recovery completed for server ${serverId}, game ID ${gameId}`);
        return gameId; // Return the game ID
    } catch (error) {
        console.error('Error saving recovery data:', error);
        throw error;
    }
}
