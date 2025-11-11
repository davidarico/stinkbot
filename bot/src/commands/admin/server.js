const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'server',
    playerCommand: false,
    async execute(bot, message, args) {
        const serverId = message.guild.id;
        const serverName = message.guild.name;
        const memberCount = message.guild.memberCount;
        console.log(`Fetching server info for ${serverName} (${serverId}) with ${memberCount} members`);

        try {
            // Get server configuration
            const configResult = await bot.db.query(
                'SELECT * FROM server_configs WHERE server_id = $1',
                [serverId]
            );

            let serverConfig = null;
            if (configResult.rows.length > 0) {
                serverConfig = configResult.rows[0];
            }

            // Get current active game
            const activeGameResult = await bot.db.query(
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
                const playersResult = await bot.db.query(
                    'SELECT COUNT(*) as total FROM players WHERE game_id = $1',
                    [activeGame.id]
                );
                playerCount = parseInt(playersResult.rows[0].total);

                // Count alive players by checking Discord roles
                const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
                if (aliveRole) {
                    const allPlayers = await bot.db.query(
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
                const additionalChannelsResult = await bot.db.query(
                    'SELECT channel_id FROM game_channels WHERE game_id = $1',
                    [activeGame.id]
                );
                gameChannels = additionalChannelsResult.rows.map(row => row.channel_id);
            }

            // Get total games played on server
            const totalGamesResult = await bot.db.query(
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

            // Get channel count
            const channelCount = message.guild.channels.cache.size;
            const channelLimit = 500; // Discord's limit
            const channelUsagePercentage = ((channelCount / channelLimit) * 100).toFixed(1);

            // Basic server info
            embed.addFields(
                { name: '📊 Basic Info', value: `**Members:** ${memberCount}\n**Total Games:** ${totalGames}\n**Channels:** ${channelCount}/${channelLimit} (${channelUsagePercentage}%)`, inline: true }
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
                await bot.db.query('SELECT 1');
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
                value: `**Prefix:** ${bot.prefix}\n**Uptime:** ${process.uptime().toFixed(0)}s`,
                inline: true
            });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error getting server information:', error);
            await message.reply('❌ An error occurred while retrieving server information.');
        }
    }
};
