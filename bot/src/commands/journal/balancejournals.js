const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'balance_journals',
    playerCommand: false,
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        // Check if user has moderator permissions
        if (!bot.hasModeratorPermissions(message.member)) {
            return message.reply('❌ You need moderator permissions to use this command.');
        }

        try {
            // Get all journal categories
            const journalCategories = message.guild.channels.cache.filter(
                channel => channel.type === ChannelType.GuildCategory &&
                (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
            );

            if (journalCategories.size === 0) {
                return message.reply('❌ No journal categories found. Create some journals first with `Wolf.journal @user`.');
            }

            // Get all journal channels from all categories
            const allJournalChannels = [];
            for (const category of journalCategories.values()) {
                const categoryChannels = message.guild.channels.cache.filter(
                    channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
                );
                allJournalChannels.push(...categoryChannels.values());
            }

            if (allJournalChannels.length === 0) {
                return message.reply('❌ No journal channels found in any journal categories.');
            }

            // Sort journals alphabetically by display name (extracted from channel name)
            allJournalChannels.sort((a, b) => {
                const nameA = a.name.replace('-journal', '').toLowerCase();
                const nameB = b.name.replace('-journal', '').toLowerCase();
                return nameA.localeCompare(nameB);
            });

            const totalJournals = allJournalChannels.length;
            const maxChannelsPerCategory = 50;

            // If we have less than 50 journals, just alphabetize in current structure
            if (totalJournals < maxChannelsPerCategory) {
                await bot.alphabetizeJournalsInCategory(message.guild, journalCategories.first());
                return message.reply(`✅ Journals are already properly organized! Found ${totalJournals} journals in a single category. All journals have been alphabetized.`);
            }

            // We need to split into multiple categories (50+ journals, including exactly 50)
            // This ensures we stay well under the Discord limit
            // For exactly 50 journals, we split into 2 categories of 25 each
            const numCategoriesNeeded = totalJournals >= maxChannelsPerCategory ? Math.max(2, Math.ceil(totalJournals / maxChannelsPerCategory)) : 1;

            // We need to split into multiple categories
            const journalsPerCategory = Math.ceil(totalJournals / numCategoriesNeeded);

            // Handle category creation/renaming for proper alphabetical order
            const newCategories = [];

            // Find the original "Journals" category
            const originalJournalsCategory = message.guild.channels.cache.find(
                channel => channel.type === ChannelType.GuildCategory && channel.name === 'Journals'
            );

            for (let i = 0; i < numCategoriesNeeded; i++) {
                const startIndex = i * journalsPerCategory;
                const endIndex = Math.min((i + 1) * journalsPerCategory, totalJournals);
                const startJournal = allJournalChannels[startIndex];
                const endJournal = allJournalChannels[endIndex - 1];

                // Extract display names for category naming
                const startName = startJournal.name.replace('-journal', '').toUpperCase();
                const endName = endJournal.name.replace('-journal', '').toUpperCase();

                // Get first letter of start and last letter of end
                const startLetter = startName.charAt(0);
                const endLetter = endName.charAt(0);

                const categoryName = `Journals (${startLetter}-${endLetter})`;

                let category;

                if (i === 0 && originalJournalsCategory) {
                    // For the first category, rename the existing "Journals" category
                    await originalJournalsCategory.setName(categoryName);
                    category = originalJournalsCategory;
                    console.log(`📝 Renamed "Journals" to "${categoryName}"`);
                } else {
                    // For subsequent categories, create new ones
                    category = message.guild.channels.cache.find(
                        channel => channel.type === ChannelType.GuildCategory && channel.name === categoryName
                    );

                    if (!category) {
                        // Create new category
                        category = await message.guild.channels.create({
                            name: categoryName,
                            type: ChannelType.GuildCategory,
                        });

                        // Position it after the previous category (which is now properly named)
                        if (i > 0 && newCategories[i - 1]) {
                            await category.setPosition(newCategories[i - 1].position + 1);
                        }
                    }
                }

                newCategories.push(category);
            }

            // First, move all journals to their appropriate categories
            let movedCount = 0;
            const movedJournals = []; // Track moved journals and their original permissions

            for (let i = 0; i < numCategoriesNeeded; i++) {
                const startIndex = i * journalsPerCategory;
                const endIndex = Math.min((i + 1) * journalsPerCategory, totalJournals);
                const categoryJournals = allJournalChannels.slice(startIndex, endIndex);

                for (const journal of categoryJournals) {
                    if (journal.parent?.id !== newCategories[i].id) {
                        // Store current permission overrides before moving the channel
                        const currentPermissions = journal.permissionOverwrites.cache;

                        // Move the channel to the new category
                        await journal.setParent(newCategories[i].id);
                        movedCount++;

                        // Store the journal and its permissions for later restoration
                        movedJournals.push({
                            journal: journal,
                            permissions: currentPermissions,
                            targetCategory: newCategories[i]
                        });

                        console.log(`Moved journal "${journal.name}" to category "${newCategories[i].name}"`);
                    }
                }
            }

            // Now wait for Discord to process all the moves, then restore permissions
            if (movedJournals.length > 0) {
                console.log(`Waiting for Discord to process ${movedJournals.length} journal moves...`);

                // Poll for all moves to be recognized
                let allMovesConfirmed = false;
                let attempts = 0;
                const maxAttempts = 15; // 15 seconds total

                while (!allMovesConfirmed && attempts < maxAttempts) {
                    // Wait 1 second before checking
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Refresh the Discord cache
                    await message.guild.channels.fetch();

                    // Check if all moves have been processed
                    allMovesConfirmed = true;
                    for (const movedJournal of movedJournals) {
                        const refreshedJournal = message.guild.channels.cache.get(movedJournal.journal.id);
                        if (!refreshedJournal || refreshedJournal.parent?.id !== movedJournal.targetCategory.id) {
                            allMovesConfirmed = false;
                            break;
                        }
                    }

                    attempts++;
                    if (!allMovesConfirmed) {
                        console.log(`⏳ Waiting for Discord to process journal moves... (attempt ${attempts}/${maxAttempts})`);
                    }
                }

                if (allMovesConfirmed) {
                    console.log(`✅ All journal moves confirmed, restoring permissions...`);

                    // Now restore permissions for all moved journals
                    for (const movedJournal of movedJournals) {
                        try {
                            for (const [id, permission] of movedJournal.permissions) {
                                const permissionData = {};

                                // Check each permission flag and set it appropriately
                                const permissions = [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.SendMessages,
                                    PermissionFlagsBits.ReadMessageHistory,
                                    PermissionFlagsBits.AttachFiles,
                                    PermissionFlagsBits.EmbedLinks,
                                    PermissionFlagsBits.UseExternalEmojis,
                                    PermissionFlagsBits.AddReactions
                                ];

                                for (const perm of permissions) {
                                    if (permission.allow.has(perm)) {
                                        permissionData[perm] = true;
                                    } else if (permission.deny.has(perm)) {
                                        permissionData[perm] = false;
                                    }
                                    // If neither allow nor deny, don't set the permission (inherits from category)
                                }

                                if (Object.keys(permissionData).length > 0) {
                                    await movedJournal.journal.permissionOverwrites.edit(id, permissionData);
                                }
                            }
                            console.log(`✅ Restored permissions for journal channel: ${movedJournal.journal.name}`);
                        } catch (permissionError) {
                            console.error(`⚠️ Warning: Could not restore permissions for journal channel ${movedJournal.journal.name}:`, permissionError);
                        }
                    }
                } else {
                    console.warn(`⚠️ Not all journal moves were confirmed after ${maxAttempts} attempts`);
                }
            }

            // Alphabetize journals within each category
            for (let i = 0; i < numCategoriesNeeded; i++) {
                await bot.alphabetizeJournalsInCategory(message.guild, newCategories[i]);
            }

            // Clean up old empty categories (except the original 'Journals' category)
            for (const category of journalCategories.values()) {
                if (category.name !== 'Journals' && category.children?.cache.size === 0) {
                    await category.delete();
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('📚 Journal Categories Balanced')
                .setDescription(`Successfully reorganized ${totalJournals} journals into ${numCategoriesNeeded} categories.`)
                .addFields(
                    { name: 'Total Journals', value: totalJournals.toString(), inline: true },
                    { name: 'Categories Created', value: numCategoriesNeeded.toString(), inline: true },
                    { name: 'Journals Moved', value: movedCount.toString(), inline: true }
                )
                .setColor(0x00AE86);

            // Add category breakdown
            let categoryBreakdown = '';
            for (let i = 0; i < newCategories.length; i++) {
                const startIndex = i * journalsPerCategory;
                const endIndex = Math.min((i + 1) * journalsPerCategory, totalJournals);
                const startJournal = allJournalChannels[startIndex];
                const endJournal = allJournalChannels[endIndex - 1];
                const startName = startJournal.name.replace('-journal', '').toUpperCase();
                const endName = endJournal.name.replace('-journal', '').toUpperCase();
                const startLetter = startName.charAt(0);
                const endLetter = endName.charAt(0);
                const journalCount = endIndex - startIndex;

                categoryBreakdown += `• **${newCategories[i].name}**: ${journalCount} journals (${startLetter}-${endLetter})\n`;
            }

            embed.addFields({ name: 'Category Breakdown', value: categoryBreakdown });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error balancing journals:', error);
            await message.reply('❌ An error occurred while balancing journals.');
        }
    }
};
