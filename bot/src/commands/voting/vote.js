module.exports = {
    name: 'vote',
    playerCommand: true,
    async execute(bot, message, args) {
        const serverId = message.guild.id;
        const voterId = message.author.id;

        // Get active game
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Check if it's day phase
        if (game.day_phase === 'night') {
            return message.reply('❌ Voting is not allowed during the night phase.');
        }

        // Check if in voting booth
        if (message.channel.id !== game.voting_booth_channel_id) {
            const votingChannel = await bot.client.channels.fetch(game.voting_booth_channel_id);
            return message.reply(`❌ Please vote in ${votingChannel} instead.`);
        }

        // Check if voter is in the game and has Alive role
        const voterCheck = await bot.db.query(
            'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
            [game.id, voterId]
        );

        if (!voterCheck.rows.length) {
            return message.reply('❌ You are not in this game.');
        }

        // Check if voter has Alive role
        const voterMember = message.member;
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        if (!aliveRole || !voterMember.roles.cache.has(aliveRole.id)) {
            return message.reply('❌ You are not an alive player in this game.');
        }

        // Parse target
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('❌ Please mention a user to vote for.');
        }

        // Check if user is trying to vote for themselves
        if (target.id === voterId && process.env.NODE_ENV !== 'development') {
            return message.reply('❌ You cannot vote for yourself.');
        }

        // Check if target is in the game and has Alive role
        const targetCheck = await bot.db.query(
            'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
            [game.id, target.id]
        );

        if (!targetCheck.rows.length) {
            return message.reply('❌ That player is not in this game.');
        }

        // Check if target has Alive role
        const targetMember = await message.guild.members.fetch(target.id).catch(() => null);
        if (!targetMember) {
            return message.reply('❌ Could not find that user in this server.');
        }

        if (!aliveRole || !targetMember.roles.cache.has(aliveRole.id)) {
            return message.reply('❌ That player is not an alive player in this game.');
        }

        // Remove existing vote if any
        await bot.db.query(
            'DELETE FROM votes WHERE game_id = $1 AND voter_user_id = $2 AND day_number = $3',
            [game.id, voterId, game.day_number]
        );

        // Add new vote
        await bot.db.query(
            'INSERT INTO votes (game_id, voter_user_id, target_user_id, day_number) VALUES ($1, $2, $3, $4)',
            [game.id, voterId, target.id, game.day_number]
        );

        // React with checkmark for success
        await message.react('✅');

        // Update voting message
        await bot.updateVotingMessage(game);
    }
};
