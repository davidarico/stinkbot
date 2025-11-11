module.exports = {
    name: 'lockdown',
    playerCommand: false,
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        try {
            // Get the active game
            const activeGameResult = await bot.db.query(
                'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3) ORDER BY id DESC LIMIT 1',
                [serverId, 'signup', 'active']
            );

            if (activeGameResult.rows.length === 0) {
                await message.reply('❌ No active game found for this server.');
                return;
            }

            const game = activeGameResult.rows[0];

            // Get the alive role
            const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');

            if (!aliveRole) {
                await message.reply('❌ Could not find the alive role for this server.');
                return;
            }

            // Check if this is a lift command
            if (args.length > 0 && args[0].toLowerCase() === 'lift') {
                // Lift lockdown - restore normal permissions
                await bot.setChannelPermissions(game, aliveRole, true, message);

                // Send lift message to townsquare
                if (game.town_square_channel_id) {
                    try {
                        const townSquareChannel = await bot.client.channels.fetch(game.town_square_channel_id);
                        if (townSquareChannel) {
                            await townSquareChannel.send('🔓 **Lockdown has been lifted, enjoy your time in the yard**');
                        }
                    } catch (error) {
                        console.error('Error sending lift message to townsquare:', error);
                    }
                }

                await message.reply('🔓 Lockdown lifted! Players can now speak in townsquare and memos.');
            } else {
                // Apply lockdown - restrict message permissions
                await bot.setChannelPermissions(game, aliveRole, false, message);

                // Send lockdown message to townsquare
                if (game.town_square_channel_id) {
                    try {
                        const townSquareChannel = await bot.client.channels.fetch(game.town_square_channel_id);
                        if (townSquareChannel) {
                            await townSquareChannel.send('🔒 **Lockdown!** Looks like the inmates were getting too rowdy');
                        }
                    } catch (error) {
                        console.error('Error sending lockdown message to townsquare:', error);
                    }
                }

                await message.reply('🔒 Lockdown applied! Players can no longer speak in townsquare and memos.');
            }

        } catch (error) {
            console.error('Error handling lockdown command:', error);
            await message.reply('❌ An error occurred while processing the lockdown command.');
        }
    }
};
