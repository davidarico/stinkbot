module.exports = {
    name: 'inlist',
    playerCommand: false,
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        // Get active game in signup phase
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3)',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game available.');
        }

        const game = gameResult.rows[0];

        // Get all signed up players
        const playersResult = await bot.db.query(
            'SELECT username FROM players WHERE game_id = $1',
            [game.id]
        );

        if (playersResult.rows.length === 0) {
            return message.reply('📝 No players have signed up yet.');
        }

        // Create a simple, mobile-friendly format with alphanumeric sorting
        const playerNames = playersResult.rows.map(p => p.username);

        // Check if za parameter is provided for reverse sorting
        const reverseSort = args.includes('za');

        // Sort players by stripping non-alphanumeric characters while maintaining original display names
        const sortedPlayerNames = playerNames.sort((a, b) => {
            const aClean = a.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const bClean = b.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const comparison = aClean.localeCompare(bClean);
            return reverseSort ? -comparison : comparison;
        });

        const playerList = sortedPlayerNames.join('\n');

        const serverConfig = await bot.db.query(
            'SELECT * FROM server_configs WHERE server_id = $1',
            [serverId]
        );
        const config = serverConfig.rows[0];
        const gameName = config.game_name;

        // Send as a code block for easy copying
        const response = `**${gameName} Game ${game.game_number} Player List (${playersResult.rows.length}):**\n${playerList}`;

        await message.reply(response);
    }
};
