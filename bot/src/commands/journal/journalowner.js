const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'journal_owner',
    playerCommand: false,
    async execute(bot, message, args) {
        const serverId = message.guild.id;
        const channelId = message.channel.id;

        try {
            // Check if this channel is a journal
            const journalResult = await bot.db.query(
                'SELECT user_id FROM player_journals WHERE server_id = $1 AND channel_id = $2',
                [serverId, channelId]
            );

            if (journalResult.rows.length === 0) {
                return message.reply('❌ This command can only be used in a journal channel.');
            }

            const userId = journalResult.rows[0].user_id;

            try {
                // Try to fetch the user from the guild
                const member = await message.guild.members.fetch(userId);
                const displayName = member.displayName || member.user.displayName || member.user.username;

                const embed = new EmbedBuilder()
                    .setTitle('📔 Journal Owner')
                    .setDescription(`This journal belongs to **${displayName}** (${member.user.tag})`)
                    .setColor(0x9B59B6)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

                await message.reply({ embeds: [embed] });

            } catch (fetchError) {
                // User might have left the server
                const embed = new EmbedBuilder()
                    .setTitle('📔 Journal Owner')
                    .setDescription(`This journal belongs to a user who is no longer in the server.\nUser ID: ${userId}`)
                    .setColor(0x95A5A6);

                await message.reply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Error getting journal owner:', error);
            await message.reply('❌ An error occurred while retrieving journal owner information.');
        }
    }
};
