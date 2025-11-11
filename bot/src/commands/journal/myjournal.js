const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'my_journal',
    playerCommand: true,
    async execute(bot, message, args) {
        const serverId = message.guild.id;
        const userId = message.author.id;

        try {
            // Check if user has a journal in this server
            const journalResult = await bot.db.query(
                'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
                [serverId, userId]
            );

            if (journalResult.rows.length === 0) {
                return message.reply('📔 You don\'t have a journal yet. Ask a moderator to create one for you with `Wolf.journal @yourname`.');
            }

            const channelId = journalResult.rows[0].channel_id;

            // Verify the channel still exists
            try {
                const journalChannel = await message.guild.channels.fetch(channelId);
                if (!journalChannel) {
                    // Channel was deleted, remove from database
                    await bot.db.query(
                        'DELETE FROM player_journals WHERE server_id = $1 AND user_id = $2',
                        [serverId, userId]
                    );
                    return message.reply('📔 Your journal channel no longer exists. Ask a moderator to create a new one with `Wolf.journal @yourname`.');
                }

                const embed = new EmbedBuilder()
                    .setTitle('📔 Your Journal')
                    .setDescription(`Here's your personal journal: <#${channelId}>`)
                    .setColor(0x8B4513);

                await message.reply({ embeds: [embed] });

            } catch (error) {
                // Channel doesn't exist, remove from database
                await bot.db.query(
                    'DELETE FROM player_journals WHERE server_id = $1 AND user_id = $2',
                    [serverId, userId]
                );
                return message.reply('📔 Your journal channel no longer exists. Ask a moderator to create a new one with `Wolf.journal @yourname`.');
            }

        } catch (error) {
            console.error('Error finding user journal:', error);
            await message.reply('❌ An error occurred while looking for your journal.');
        }
    }
};
