module.exports = {
    name: 'out',
    playerCommand: true,
    async execute(bot, message, args) {
        const serverId = message.guild.id;
        const userId = message.author.id;

        // Get active game
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'signup']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game available for signups.');
        }

        const game = gameResult.rows[0];

        // Remove player
        const deleteResult = await bot.db.query(
            'DELETE FROM players WHERE game_id = $1 AND user_id = $2',
            [game.id, userId]
        );

        if (deleteResult.rowCount === 0) {
            return message.reply('❌ You are not signed up for this game.');
        }

        // Remove "Signed Up" role
        await bot.removeRole(message.member, 'Signed Up');
        await bot.assignRole(message.member, 'Spectator');

        // React with checkmark for success
        await message.react('✅');

        // Update signup message with current players
        await bot.updateSignupMessage(game);
    }
};
