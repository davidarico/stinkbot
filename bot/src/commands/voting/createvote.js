module.exports = {
    name: 'create_vote',
    description: 'Manually create a voting message (voting booth only)',
    playerCommand: false,
    async execute(message, args, client, db, bot) {
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

        // Check if it's day phase and day 2+ (when voting is allowed)
        if (game.day_phase === 'night') {
            return message.reply('❌ Voting messages can only be created during the day phase.');
        }

        try {
            const votingChannel = await client.channels.fetch(game.voting_booth_channel_id);

            // Create the new voting message (this will overwrite the stored ID)
            await bot.createVotingMessage(game.id, votingChannel);

            // Get the updated game data with the new voting message ID
            const updatedGameResult = await db.query(
                'SELECT * FROM games WHERE server_id = $1 AND status = $2',
                [serverId, 'active']
            );
            const updatedGame = updatedGameResult.rows[0];

            // Immediately update the voting message with current votes
            await bot.updateVotingMessage(updatedGame);

            await message.reply('✅ Voting message created successfully!');

        } catch (error) {
            console.error('Error creating voting message:', error);
            await message.reply('❌ An error occurred while creating the voting message.');
        }
    }
};
