module.exports = {
    name: 'in',
    playerCommand: true,
    async execute(bot, message, args) {
        const serverId = message.guild.id;
        const user = message.author;

        // Check if user is banned
        const bannedUser = await bot.db.query(
            'SELECT * FROM banned_users WHERE user_id = $1',
            [user.id]
        );

        if (bannedUser.rows.length > 0) {
            return message.reply('❌ It would apear you are banned... uh oh...');
        }

        // Get active game
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'signup']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game available for signups.');
        }

        const game = gameResult.rows[0];

        // Check if already signed up
        const existingPlayer = await bot.db.query(
            'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
            [game.id, user.id]
        );

        if (existingPlayer.rows.length > 0) {
            return message.reply('❌ You are already signed up for this game.');
        }

        // Get display name (displayName property or fallback to username)
        const displayName = message.member?.displayName || user.displayName || user.username;

        // Add player to the database using display name
        await bot.db.query(
            'INSERT INTO players (game_id, user_id, username) VALUES ($1, $2, $3)',
            [game.id, user.id, displayName]
        );

        // Check if user has a journal, create one if they don't
        bot.ensureUserHasJournal(message, user);

        // Assign "Signed Up" role
        await bot.assignRole(message.member, 'Signed Up');
        await bot.removeRole(message.member, 'Spectator');

        // React with checkmark for success
        await message.react('✅');

        // Update signup message with current players
        await bot.updateSignupMessage(game);
    }
};
