const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'get_votes',
    description: 'Display current vote status and voting message info',
    playerCommand: false,
    async execute(message, args, client, db) {
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

        // Check if it's day phase
        if (game.day_phase === 'night') {
            return message.reply('❌ Voting is not active during the night phase.');
        }

        if (game.day_number < 2) {
            return message.reply('❌ Voting is not allowed on Day 1.');
        }

        try {
            // Get current votes
            const votesResult = await db.query(
                `SELECT v.target_user_id, p.username as target_username,
                        COUNT(*) as vote_count,
                        STRING_AGG(p2.username, ', ') as voters
                 FROM votes v
                 JOIN players p ON v.target_user_id = p.user_id AND p.game_id = v.game_id
                 JOIN players p2 ON v.voter_user_id = p2.user_id AND p2.game_id = v.game_id
                 WHERE v.game_id = $1 AND v.day_number = $2
                 GROUP BY v.target_user_id, p.username
                 ORDER BY vote_count DESC, p.username`,
                [game.id, game.day_number]
            );

            // Get voting message status
            let votingMessageStatus = '❌ No voting message found';
            if (game.voting_message_id) {
                try {
                    const votingChannel = await client.channels.fetch(game.voting_booth_channel_id);
                    const votingMessage = await votingChannel.messages.fetch(game.voting_message_id);
                    if (votingMessage) {
                        votingMessageStatus = `✅ Active voting message: [${game.voting_message_id}]`;
                    }
                } catch (error) {
                    votingMessageStatus = `⚠️ Stored voting message not found: ${game.voting_message_id}`;
                }
            }

            let voteText = 'No votes cast yet.';
            if (votesResult.rows.length > 0) {
                voteText = votesResult.rows.map(row => {
                    const voters = row.voters.split(', ').map(voter => `- ${voter}`).join('\n');
                    return `**${row.target_username}** (${row.vote_count})\n${voters}`;
                }).join('\n\n');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🗳️ Day ${game.day_number} Vote Status`)
                .setDescription(`**Game Phase:** ${game.day_phase === 'day' ? '🌞 Day' : '🌙 Night'} ${game.day_number}\n**Votes needed to hang:** ${game.votes_to_hang}\n**Voting Message:** ${votingMessageStatus}`)
                .addFields({ name: 'Current Votes', value: voteText })
                .setColor(0x3498DB)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error getting vote status:', error);
            await message.reply('❌ An error occurred while retrieving vote status.');
        }
    }
};
