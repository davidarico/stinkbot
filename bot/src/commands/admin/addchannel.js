const { EmbedBuilder, ChannelType } = require('discord.js');

module.exports = {
    name: 'add_channel',
    playerCommand: false,
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

        // Check if channel name is provided
        if (!args.length) {
            return message.reply('❌ Please provide a channel name. Usage: `Wolf.add_channel <channel-name>`');
        }

        const game = gameResult.rows[0];
        const channelName = args.join('-').toLowerCase();

        // Get roles
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');
        const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');

        // Get server config for prefix
        const configResult = await bot.db.query(
            'SELECT * FROM server_configs WHERE server_id = $1',
            [serverId]
        );
        const config = configResult.rows[0];

        // Create the full channel name with prefix
        const fullChannelName = `${config.game_prefix}${game.game_number}-${channelName}`;

        try {
            // Create the channel in the game category with proper permissions
            const category = await bot.client.channels.fetch(game.category_id);
            const newChannel = await message.guild.channels.create({
                name: fullChannelName,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: message.guild.roles.everyone.id,
                        deny: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: modRole.id,
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: spectatorRole.id,
                        allow: ['ViewChannel'],
                        deny: ['SendMessages']
                    },
                    {
                        id: aliveRole.id,
                        deny: ['ViewChannel'],
                        allow: ['SendMessages']
                    }
                ]
            });

            // Position the channel between voting booth and wolf chat
            try {
                // Find the wolf chat channel to position our new channel before it
                const wolfChatChannel = category.children.cache.find(channel =>
                    channel.name.includes('-wolf-chat')
                );

                if (wolfChatChannel) {
                    // Position the new channel just before wolf chat
                    await newChannel.setPosition(wolfChatChannel.position);
                    console.log(`Positioned new channel "${fullChannelName}" before wolf chat`);
                }
            } catch (positionError) {
                console.error('Error positioning new channel:', positionError);
                // Continue even if positioning fails - channel is still created
            }

            // Permissions are set during channel creation

            // Save channel to database with default day/night messages from the game
            await bot.db.query(
                'INSERT INTO game_channels (game_id, channel_id, channel_name, day_message, night_message, is_created) VALUES ($1, $2, $3, $4, $5, $6)',
                [game.id, newChannel.id, fullChannelName, game.day_message, game.night_message, true]
            );

            const embed = new EmbedBuilder()
                .setTitle('📁 Channel Created')
                .setDescription(`Successfully created new game channel!`)
                .addFields(
                    { name: 'Channel', value: `<#${newChannel.id}>`, inline: true },
                    { name: 'Name', value: fullChannelName, inline: true }
                )
                .setColor(0x00AE86);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error creating channel:', error);
            await message.reply('❌ An error occurred while creating the channel.');
        }
    }
};
