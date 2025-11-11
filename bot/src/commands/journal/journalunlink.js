const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'journal_unlink',
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
                return message.reply('❌ This command can only be used in a journal channel that is currently linked to a user.');
            }

            const userId = journalResult.rows[0].user_id;

            // Get user information for confirmation
            let userInfo = `User ID: ${userId}`;
            try {
                const member = await message.guild.members.fetch(userId);
                const displayName = member.displayName || member.user.displayName || member.user.username;
                userInfo = `**${displayName}** (${member.user.tag})`;
            } catch (fetchError) {
                userInfo = `User who left the server (ID: ${userId})`;
            }

            // Confirmation
            const confirmEmbed = new EmbedBuilder()
                .setTitle('⚠️ Confirm Journal Unlink')
                .setDescription(`Are you sure you want to unlink this journal from ${userInfo}?`)
                .setColor(0xE74C3C);

            await message.reply({ embeds: [confirmEmbed] });
            await message.reply('Type `confirm` to unlink or `cancel` to abort.');

            const filter = (m) => m.author.id === message.author.id && ['confirm', 'cancel'].includes(m.content.toLowerCase());
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });

            if (!collected.size || collected.first().content.toLowerCase() === 'cancel') {
                return message.reply('❌ Journal unlink cancelled.');
            }

            // Remove the journal association
            await bot.db.query(
                'DELETE FROM player_journals WHERE server_id = $1 AND channel_id = $2',
                [serverId, channelId]
            );

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Journal Unlinked')
                .setDescription(`Successfully unlinked this journal from ${userInfo}. The journal is now available for linking to another user.`)
                .setColor(0x00AE86);

            await message.reply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error unlinking journal:', error);
            await message.reply('❌ An error occurred while unlinking the journal.');
        }
    }
};
