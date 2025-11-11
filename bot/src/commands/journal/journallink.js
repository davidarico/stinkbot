const { EmbedBuilder, ChannelType } = require('discord.js');

module.exports = {
    name: 'journal_link',
    playerCommand: false,
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        try {
            // Get all journal channels (channels ending with -journal)
            const allChannels = await message.guild.channels.fetch();
            const journalChannels = allChannels.filter(channel =>
                channel.type === ChannelType.GuildText &&
                channel.name.endsWith('-journal')
            );

            if (journalChannels.size === 0) {
                return message.reply('❌ No journal channels found (channels ending with "-journal").');
            }

            // Get users who already have linked journals
            const existingJournals = await bot.db.query(
                'SELECT user_id, channel_id FROM player_journals WHERE server_id = $1',
                [serverId]
            );

            const linkedChannelIds = new Set(existingJournals.rows.map(row => row.channel_id));
            const linkedUserIds = new Set(existingJournals.rows.map(row => row.user_id));

            // Filter out already linked journals
            const unlinkededJournals = journalChannels.filter(channel =>
                !linkedChannelIds.has(channel.id)
            );

            if (unlinkededJournals.size === 0) {
                return message.reply('✅ All journal channels are already linked to users.');
            }

            // Get all server members (excluding bots and already linked users)
            const allMembers = await message.guild.members.fetch();
            const availableMembers = allMembers.filter(member =>
                !member.user.bot && !linkedUserIds.has(member.user.id)
            );

            if (availableMembers.size === 0) {
                return message.reply('❌ No available users to link journals to (all non-bot users already have journals).');
            }

            const embed = new EmbedBuilder()
                .setTitle('📔 Journal Linking Process')
                .setDescription(`Found ${unlinkededJournals.size} unlinked journal channels. Starting linking process...`)
                .setColor(0x9B59B6);

            await message.reply({ embeds: [embed] });

            // Process each unlinked journal
            for (const [channelId, journalChannel] of unlinkededJournals) {
                // Extract name part (remove -journal suffix)
                const journalBaseName = journalChannel.name.replace(/-journal$/, '');

                // Calculate similarity scores for all available members
                const memberScores = [];

                for (const [memberId, member] of availableMembers) {
                    // Check similarity with various name formats
                    const displayName = member.displayName || member.user.displayName || member.user.username;
                    const username = member.user.username;

                    const displayNameScore = bot.calculateSimilarity(journalBaseName, displayName);
                    const usernameScore = bot.calculateSimilarity(journalBaseName, username);

                    // Use the higher score
                    const bestScore = Math.max(displayNameScore, usernameScore);

                    memberScores.push({
                        member: member,
                        score: bestScore,
                        matchedName: displayNameScore > usernameScore ? displayName : username
                    });
                }

                // Sort by similarity score (highest first) and take top 5
                memberScores.sort((a, b) => b.score - a.score);
                const topMatches = memberScores.slice(0, 5);

                // Create selection embed
                const selectionEmbed = new EmbedBuilder()
                    .setTitle(`🔗 Link Journal: ${journalChannel.name}`)
                    .setDescription(`Journal base name: **${journalBaseName}**\n\nTop 5 matching users:`)
                    .setColor(0x3498DB);

                let optionsText = '';
                topMatches.forEach((match, index) => {
                    optionsText += `**${index + 1}.** ${match.matchedName} (${match.member.user.tag}) - ${match.score.toFixed(1)}% match\n`;
                });

                optionsText += '\n**6.** None of these - enter exact username\n**7.** Skip this journal';

                selectionEmbed.addFields({ name: 'Options', value: optionsText });

                await message.reply({ embeds: [selectionEmbed] });
                await message.reply('Please enter a number (1-7):');

                // Wait for user response
                const filter = (m) => m.author.id === message.author.id && !m.author.bot;
                const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000 });

                if (!collected.size) {
                    await message.reply('⏰ Timed out. Skipping this journal.');
                    continue;
                }

                const response = collected.first().content.trim();
                const choice = parseInt(response);

                if (choice >= 1 && choice <= 5) {
                    // User selected one of the top 5 matches
                    const selectedMatch = topMatches[choice - 1];

                    // Link the journal
                    await bot.db.query(
                        'INSERT INTO player_journals (server_id, user_id, channel_id) VALUES ($1, $2, $3)',
                        [serverId, selectedMatch.member.user.id, journalChannel.id]
                    );

                    // Remove the linked user from available members
                    availableMembers.delete(selectedMatch.member.user.id);

                    const successEmbed = new EmbedBuilder()
                        .setTitle('✅ Journal Linked')
                        .setDescription(`Successfully linked <#${journalChannel.id}> to **${selectedMatch.matchedName}** (${selectedMatch.member.user.tag})`)
                        .setColor(0x00AE86);

                    await message.reply({ embeds: [successEmbed] });

                } else if (choice === 6) {
                    // User wants to enter exact username
                    await message.reply('Please enter the exact username or display name:');

                    const usernameCollected = await message.channel.awaitMessages({ filter, max: 1, time: 60000 });

                    if (!usernameCollected.size) {
                        await message.reply('⏰ Timed out. Skipping this journal.');
                        continue;
                    }

                    const targetUsername = usernameCollected.first().content.trim();

                    // Find the member by username or display name
                    const targetMember = availableMembers.find(member => {
                        const displayName = member.displayName || member.user.displayName || member.user.username;
                        return displayName.toLowerCase() === targetUsername.toLowerCase() ||
                               member.user.username.toLowerCase() === targetUsername.toLowerCase();
                    });

                    if (!targetMember) {
                        await message.reply(`❌ Could not find an available user with the name "${targetUsername}". Skipping this journal.`);
                        continue;
                    }

                    // Link the journal
                    const finalDisplayName = targetMember.displayName || targetMember.user.displayName || targetMember.user.username;

                    await bot.db.query(
                        'INSERT INTO player_journals (server_id, user_id, channel_id) VALUES ($1, $2, $3)',
                        [serverId, targetMember.user.id, journalChannel.id]
                    );

                    // Remove the linked user from available members
                    availableMembers.delete(targetMember.user.id);

                    const successEmbed = new EmbedBuilder()
                        .setTitle('✅ Journal Linked')
                        .setDescription(`Successfully linked <#${journalChannel.id}> to **${finalDisplayName}** (${targetMember.user.tag})`)
                        .setColor(0x00AE86);

                    await message.reply({ embeds: [successEmbed] });

                } else if (choice === 7) {
                    // Skip this journal
                    await message.reply(`⏭️ Skipped journal: ${journalChannel.name}`);
                    continue;
                } else {
                    // Invalid choice
                    await message.reply('❌ Invalid choice. Skipping this journal.');
                    continue;
                }
            }

            // Final summary
            const finalEmbed = new EmbedBuilder()
                .setTitle('🏁 Journal Linking Complete')
                .setDescription('Finished processing all unlinked journal channels.')
                .setColor(0x95A5A6);

            await message.reply({ embeds: [finalEmbed] });

        } catch (error) {
            console.error('Error in journal linking:', error);
            await message.reply('❌ An error occurred during journal linking.');
        }
    }
};
