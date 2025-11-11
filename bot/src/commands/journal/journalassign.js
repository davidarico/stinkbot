const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'journal_assign',
    playerCommand: false,
    async execute(bot, message, args) {
        const serverId = message.guild.id;
        const channelId = message.channel.id;

        try {
            // Check if this is a journal channel (ends with -journal)
            if (!message.channel.name.endsWith('-journal')) {
                return message.reply('❌ This command can only be used in a journal channel (channel name must end with "-journal").');
            }

            // Check if a user was mentioned
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('❌ Please mention a user to assign this journal to. Usage: `Wolf.journal_assign @user`');
            }

            // Check if the mentioned user is in the server
            let targetMember;
            try {
                targetMember = await message.guild.members.fetch(targetUser.id);
            } catch (fetchError) {
                return message.reply('❌ The mentioned user is not in this server.');
            }

            // Check if this journal is already linked to someone
            const existingJournalResult = await bot.db.query(
                'SELECT user_id FROM player_journals WHERE server_id = $1 AND channel_id = $2',
                [serverId, channelId]
            );

            if (existingJournalResult.rows.length > 0) {
                const existingUserId = existingJournalResult.rows[0].user_id;

                // Get existing user info
                let existingUserInfo = `User ID: ${existingUserId}`;
                try {
                    const existingMember = await message.guild.members.fetch(existingUserId);
                    const existingDisplayName = existingMember.displayName || existingMember.user.displayName || existingMember.user.username;
                    existingUserInfo = `**${existingDisplayName}** (${existingMember.user.tag})`;
                } catch (fetchError) {
                    existingUserInfo = `User who left the server (ID: ${existingUserId})`;
                }

                return message.reply(`❌ This journal is already linked to ${existingUserInfo}. Use \`Wolf.journal_unlink\` first to remove the existing assignment.`);
            }

            // Check if the target user already has a journal
            const existingUserJournalResult = await bot.db.query(
                'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
                [serverId, targetUser.id]
            );

            if (existingUserJournalResult.rows.length > 0) {
                const existingChannelId = existingUserJournalResult.rows[0].channel_id;
                return message.reply(`❌ **${targetMember.displayName || targetUser.username}** already has a journal linked: <#${existingChannelId}>. Use \`Wolf.journal_unlink\` in their current journal first.`);
            }

            // Create the journal assignment
            await bot.db.query(
                'INSERT INTO player_journals (server_id, user_id, channel_id) VALUES ($1, $2, $3)',
                [serverId, targetUser.id, channelId]
            );

            const displayName = targetMember.displayName || targetUser.displayName || targetUser.username;

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Journal Assigned')
                .setDescription(`Successfully assigned this journal to **${displayName}** (${targetUser.tag})`)
                .setColor(0x00AE86)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

            await message.reply({ embeds: [successEmbed] });

            // Send a welcome message to the newly assigned user
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('📔 Your Journal')
                .setDescription(`Welcome to your personal journal, <@${targetUser.id}>! You can use this channel to keep notes, strategies, and thoughts during the game.`)
                .setColor(0x9B59B6)
                .setFooter({ text: 'Use Wolf.my_journal to find this channel from anywhere!' });

            await message.channel.send({ embeds: [welcomeEmbed] });

        } catch (error) {
            console.error('Error assigning journal:', error);
            await message.reply('❌ An error occurred while assigning the journal.');
        }
    }
};
