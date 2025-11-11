const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'settings',
    playerCommand: false,  // admin only
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3)',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // If no arguments provided, display current settings (anyone can view)
        if (args.length === 0) {
            // Get additional channels for this game
            const channelsResult = await bot.db.query(
                'SELECT channel_name, day_message, night_message FROM game_channels WHERE game_id = $1 ORDER BY channel_name',
                [game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Game Settings')
                .setDescription('Current game settings for this server:')
                .addFields(
                    { name: 'Votes to Hang', value: `${game.votes_to_hang}\n*To change: \`Wolf.settings votes_to_hang 3\`*`, inline: false },
                    { name: 'Default Day Message', value: `${game.day_message}\n*To change: \`Wolf.settings day_message Your message here\`*`, inline: false },
                    { name: 'Default Night Message', value: `${game.night_message}\n*To change: \`Wolf.settings night_message Your message here\`*`, inline: false },
                    { name: 'Wolf Day Message', value: `${game.wolf_day_message || 'Not set'}\n*To change: \`Wolf.settings wolf day_message Your message here\`*`, inline: false },
                    { name: 'Wolf Night Message', value: `${game.wolf_night_message || 'Not set'}\n*To change: \`Wolf.settings wolf night_message Your message here\`*`, inline: false }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            // Add channel-specific messages if any exist
            if (channelsResult.rows.length > 0) {
                let channelInfo = '';
                for (const channel of channelsResult.rows) {
                    const shortName = channel.channel_name.split('-').slice(-1)[0]; // Get the last part after the last dash
                    channelInfo += `**${shortName}:**\n`;
                    channelInfo += `Day: ${channel.day_message || 'Using default'}\n`;
                    channelInfo += `Night: ${channel.night_message || 'Using default'}\n`;
                    channelInfo += `*To change: \`Wolf.settings ${shortName} day_message/night_message Your message\`*\n\n`;
                }

                embed.addFields({
                    name: 'Channel-Specific Messages',
                    value: channelInfo.trim(),
                    inline: false
                });
            }

            return message.reply({ embeds: [embed] });
        }

        // Check permissions for changing settings (moderators only)
        if (!bot.hasModeratorPermissions(message.member)) {
            return message.reply('❌ You need moderator permissions to change game settings.');
        }

        // Handle setting changes
        const firstArg = args[0].toLowerCase();

        // Check if this is a wolf-specific setting (format: wolf day_message|night_message <message>)
        if (firstArg === 'wolf' && args.length >= 3) {
            const settingType = args[1].toLowerCase();

            if (settingType === 'day_message') {
                const newMessage = args.slice(2).join(' ');

                // Update the wolf day message
                await bot.db.query(
                    'UPDATE games SET wolf_day_message = $1 WHERE id = $2',
                    [newMessage, game.id]
                );

                const embed = new EmbedBuilder()
                    .setTitle('🐺🌅 Wolf Day Message Updated')
                    .setDescription('✅ **Wolf Day Message** has been updated!')
                    .addFields(
                        { name: 'New Wolf Day Message', value: newMessage, inline: false }
                    )
                    .setColor(0xF1C40F)
                    .setTimestamp();

                return message.reply({ embeds: [embed] });

            } else if (settingType === 'night_message') {
                const newMessage = args.slice(2).join(' ');

                // Update the wolf night message
                await bot.db.query(
                    'UPDATE games SET wolf_night_message = $1 WHERE id = $2',
                    [newMessage, game.id]
                );

                const embed = new EmbedBuilder()
                    .setTitle('🐺🌙 Wolf Night Message Updated')
                    .setDescription('✅ **Wolf Night Message** has been updated!')
                    .addFields(
                        { name: 'New Wolf Night Message', value: newMessage, inline: false }
                    )
                    .setColor(0x2C3E50)
                    .setTimestamp();

                return message.reply({ embeds: [embed] });

            } else {
                return message.reply('❌ Wolf message type must be `day_message` or `night_message`. Example: `Wolf.settings wolf day_message Your message here`');
            }
        }

        // Check if this is a channel-specific setting (format: <channel_name> day_message|night_message <message>)
        if (args.length >= 3) {
            const channelName = firstArg;
            const settingType = args[1].toLowerCase();

            if (settingType === 'day_message' || settingType === 'night_message') {
                // Find the channel in the database
                const channelResult = await bot.db.query(
                    'SELECT * FROM game_channels WHERE game_id = $1 AND (channel_name LIKE $2 OR channel_name LIKE $3)',
                    [game.id, `%${channelName}`, `%${channelName}%`]
                );

                if (!channelResult.rows.length) {
                    return message.reply(`❌ Channel "${channelName}" not found. Make sure you use the short channel name (e.g., "memes" for "g1-memes").`);
                }

                const channel = channelResult.rows[0];
                const newMessage = args.slice(2).join(' ');

                // Update the channel's message
                const columnName = settingType;
                await bot.db.query(
                    `UPDATE game_channels SET ${columnName} = $1 WHERE id = $2`,
                    [newMessage, channel.id]
                );

                const shortName = channel.channel_name.split('-').slice(-1)[0];
                const messageType = settingType === 'day_message' ? 'Day' : 'Night';
                const emoji = settingType === 'day_message' ? '🌅' : '🌙';

                const embed = new EmbedBuilder()
                    .setTitle(`${emoji} Channel ${messageType} Message Updated`)
                    .setDescription(`✅ **${shortName}** ${messageType.toLowerCase()} message has been updated!`)
                    .addFields(
                        { name: `New ${messageType} Message`, value: newMessage, inline: false }
                    )
                    .setColor(settingType === 'day_message' ? 0xF1C40F : 0x2C3E50)
                    .setTimestamp();

                return message.reply({ embeds: [embed] });
            }
        }

        // Handle global game settings
        if (firstArg === 'votes_to_hang') {
            const value = args[1];
            if (!value) {
                return message.reply('❌ Please provide a value for votes_to_hang. Example: `Wolf.settings votes_to_hang 3`');
            }

            const newValue = parseInt(value);
            if (isNaN(newValue) || newValue < 1 || newValue > 20) {
                return message.reply('❌ Votes to hang must be a number between 1 and 20.');
            }

            // Update the game setting
            await bot.db.query(
                'UPDATE games SET votes_to_hang = $1 WHERE id = $2',
                [newValue, game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Setting Updated')
                .setDescription(`✅ **Votes to Hang** has been updated to **${newValue}**`)
                .setColor(0x27AE60)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            // Update voting message if it exists
            await bot.updateVotingMessage({ ...game, votes_to_hang: newValue });

        } else if (firstArg === 'day_message') {
            if (args.length < 2) {
                return message.reply('❌ Please provide a day message. Example: `Wolf.settings day_message WAKE UP! Time to vote!`');
            }

            const newMessage = args.slice(1).join(' ');

            // Update the default day message
            await bot.db.query(
                'UPDATE games SET day_message = $1 WHERE id = $2',
                [newMessage, game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('🌅 Default Day Message Updated')
                .setDescription('✅ **Default Day Message** has been updated!')
                .addFields(
                    { name: 'New Day Message', value: newMessage, inline: false }
                )
                .setColor(0xF1C40F)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } else if (firstArg === 'night_message') {
            if (args.length < 2) {
                return message.reply('❌ Please provide a night message. Example: `Wolf.settings night_message Night falls. Someone is snoring really loudly.`');
            }

            const newMessage = args.slice(1).join(' ');

            // Update the default night message
            await bot.db.query(
                'UPDATE games SET night_message = $1 WHERE id = $2',
                [newMessage, game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('🌙 Default Night Message Updated')
                .setDescription('✅ **Default Night Message** has been updated!')
                .addFields(
                    { name: 'New Night Message', value: newMessage, inline: false }
                )
                .setColor(0x2C3E50)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } else {
            return message.reply('❌ Unknown setting. Available settings:\n• `votes_to_hang`\n• `day_message`, `night_message` (default messages)\n• `wolf day_message`, `wolf night_message` (wolf chat specific)\n• `<channel_name> day_message`, `<channel_name> night_message` (channel-specific)');
        }
    }
};
