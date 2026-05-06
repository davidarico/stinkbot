'use strict';

const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const crypto = require('crypto');

// https://discord.com/developers/docs/topics/permissions?pubDate=20250525
const PIN_PERMISSION = 0x0008000000000000;

module.exports = {

async handleJournal(message, args) {
    const serverId = message.guild.id;

    // Check if user mentioned someone
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
        return message.reply('❌ Please mention a user to create a journal for. Usage: `Wolf.journal @user`');
    }

    // Check if the mentioned user is in the server
    const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
        return message.reply('❌ That user is not in this server.');
    }

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 ORDER BY game_number DESC LIMIT 1',
        [serverId]
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No games found. Please create a game first.');
    }

    const game = gameResult.rows[0];

    try {
        // Proactively check if we need to split journals before creating a new one
        const splitPerformed = await this.checkAndProactivelySplitJournals(message.guild, message);
        
        // Find the appropriate journal category for this user (may have changed after split)
        let targetCategory = await this.findAppropriateJournalCategory(message.guild, targetMember.displayName);

        if (!targetCategory) {
            // Create the main Journals category if no categories exist
            targetCategory = await message.guild.channels.create({
                name: 'Journals',
                type: ChannelType.GuildCategory,
            });

            // Position it under the current game but above other games
            try {
                const currentGameCategory = await this.client.channels.fetch(game.category_id);
                if (currentGameCategory) {
                    const targetPosition = currentGameCategory.position + 1;
                    await targetCategory.setPosition(targetPosition);
                    console.log(`Positioned Journals category at position ${targetPosition}`);
                }
            } catch (error) {
                console.error('Error positioning Journals category:', error);
            }
        }

        // Create journal channel name
        const journalChannelName = `${targetMember.displayName.toLowerCase().replace(/\s+/g, '-')}-journal`;

        // Check if journal already exists
        const existingJournal = message.guild.channels.cache.find(
            channel => channel.name === journalChannelName && channel.parent?.id === targetCategory.id
        );

        if (existingJournal) {
            return message.reply(`❌ A journal for ${targetMember.displayName} already exists: <#${existingJournal.id}>`);
        }

        // Get roles for permissions
        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');
        const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');

        // Create the journal channel with proper permissions
        const journalChannel = await message.guild.channels.create({
            name: journalChannelName,
            type: ChannelType.GuildText,
            parent: targetCategory.id,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
                {
                    id: targetUser.id,
                    // Omit PIN_PERMISSION here: Discord's PinMessages (1<<51) is not in discord.js 14's
                    // PermissionFlagsBits, so including it causes BitFieldInvalid when creating the channel.
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
                ...(modRole ? [{
                    id: modRole.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                }] : []),
                ...(spectatorRole ? [{
                    id: spectatorRole.id,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages],
                }] : []),
                ...(deadRole ? [{
                    id: deadRole.id,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages],
                }] : [])
            ],
        });

        // Send initial message to the journal
        const embed = new EmbedBuilder()
            .setTitle(`📔 ${targetMember.displayName}'s Journal`)
            .setDescription(`Welcome to your personal journal, ${targetMember.displayName}!\n\nThis is your private space to:\n• Take notes during the game\n• Ask questions to the moderators\n• Record your thoughts and observations\n\n**Permissions:**\n• **You** can read and write\n• **Moderators** can read and write\n• **Spectators** can read only\n\n💡 **Tip:** You can rename your journal anytime using \`Wolf.rename_journal <new-name>\``)
            .setColor(0x8B4513)
            .setTimestamp();

        await journalChannel.send({ embeds: [embed] });
        
        // Ping the user to notify them of their new journal
        await journalChannel.send(`${targetMember} - Your journal has been created! 📔`);

        // Save journal to database
        await this.db.query(
            `INSERT INTO player_journals (server_id, user_id, channel_id) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (server_id, user_id) 
             DO UPDATE SET channel_id = $3, created_at = CURRENT_TIMESTAMP`,
            [serverId, targetUser.id, journalChannel.id]
        );

        // Reply with success
        const successEmbed = new EmbedBuilder()
            .setTitle('📔 Journal Created')
            .setDescription(`Successfully created a journal for ${targetMember.displayName}`)
            .addFields(
                { name: 'Channel', value: `<#${journalChannel.id}>`, inline: true },
                { name: 'Player', value: `${targetMember.displayName}`, inline: true }
            )
            .setColor(0x00AE86);

        await message.reply({ embeds: [successEmbed] });

        // After creating the journal, alphabetize it within its category and check if we need to rebalance
        await this.alphabetizeJournalsInCategory(message.guild, targetCategory);
        await this.checkAndRebalanceJournals(message.guild);

    } catch (error) {
        console.error('Error creating journal:', error);
        await message.reply('❌ An error occurred while creating the journal.');
    }
},

async ensureUserHasJournal(message, user) {
    const serverId = message.guild.id;
    
    try {
        // Check if user already has a journal
        const existingJournal = await this.db.query(
            'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
            [serverId, user.id]
        );

        if (existingJournal.rows.length > 0) {
            // User already has a journal, verify the channel still exists
            const journalChannel = await this.client.channels.fetch(existingJournal.rows[0].channel_id).catch(() => null);
            if (journalChannel) {
                return; // Journal exists and channel is valid
            }
            // Channel doesn't exist, we'll create a new one
        }

        // Get the user's member object
        const targetMember = await message.guild.members.fetch(user.id).catch(() => null);
        if (!targetMember) {
            console.error(`Could not fetch member ${user.tag} for journal creation`);
            return;
        }

        // Proactively check if we need to split journals before creating a new one
        const splitPerformed = await this.checkAndProactivelySplitJournals(message.guild);
        
        // Get active game for category positioning
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 ORDER BY game_number DESC LIMIT 1',
            [serverId]
        );

        // Find the appropriate journal category for this user (may have changed after split)
        let targetCategory = await this.findAppropriateJournalCategory(message.guild, targetMember.displayName);

        if (!targetCategory) {
            // Create the main Journals category if no categories exist
            targetCategory = await message.guild.channels.create({
                name: 'Journals',
                type: ChannelType.GuildCategory,
            });

            // Position it under the current game but above other games
            if (gameResult.rows.length > 0) {
                try {
                    const currentGameCategory = await this.client.channels.fetch(gameResult.rows[0].category_id);
                    if (currentGameCategory) {
                        const targetPosition = currentGameCategory.position + 1;
                        await targetCategory.setPosition(targetPosition);
                        console.log(`Positioned Journals category at position ${targetPosition}`);
                    }
                } catch (error) {
                    console.error('Error positioning Journals category:', error);
                }
            }
        }

        // Create journal channel name
        const journalChannelName = `${targetMember.displayName.toLowerCase().replace(/\s+/g, '-')}-journal`;

        // Check if journal already exists
        const existingJournalChannel = message.guild.channels.cache.find(
            channel => channel.name === journalChannelName && channel.parent?.id === targetCategory.id
        );

        if (existingJournalChannel) {
            // Update database to link existing channel to user
            await this.db.query(
                `INSERT INTO player_journals (server_id, user_id, channel_id) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (server_id, user_id) 
                 DO UPDATE SET channel_id = $3, created_at = CURRENT_TIMESTAMP`,
                [serverId, user.id, existingJournalChannel.id]
            );
            return;
        }

        // Get roles for permissions
        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');
        const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');

        // Create the journal channel with proper permissions
        const journalChannel = await message.guild.channels.create({
            name: journalChannelName,
            type: ChannelType.GuildText,
            parent: targetCategory.id,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
                {
                    id: user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
                ...(modRole ? [{
                    id: modRole.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                }] : []),
                ...(spectatorRole ? [{
                    id: spectatorRole.id,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages],
                }] : []),
                ...(deadRole ? [{
                    id: deadRole.id,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages],
                }] : [])
            ],
        });

        // Send initial message to the journal
        const embed = new EmbedBuilder()
            .setTitle(`📔 ${targetMember.displayName}'s Journal`)
            .setDescription(`Welcome to your personal journal, ${targetMember.displayName}!\n\nThis is your private space to:\n• Take notes during the game\n• Ask questions to the moderators\n• Record your thoughts and observations\n\n**Permissions:**\n• **You** can read and write\n• **Moderators** can read and write\n• **Spectators** can read only\n\n💡 **Tip:** You can rename your journal anytime using \`Wolf.rename_journal <new-name>\``)
            .setColor(0x8B4513)
            .setTimestamp();

        await journalChannel.send({ embeds: [embed] });
        
        // Ping the user to notify them of their new journal
        await journalChannel.send(`${targetMember} - Your journal has been created! 📔`);

        // Save journal to database
        await this.db.query(
            `INSERT INTO player_journals (server_id, user_id, channel_id) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (server_id, user_id) 
             DO UPDATE SET channel_id = $3, created_at = CURRENT_TIMESTAMP`,
            [serverId, user.id, journalChannel.id]
        );

        console.log(`📔 Auto-created journal for ${targetMember.displayName} (${user.id})`);

        // After creating the journal, alphabetize it within its category and check if we need to rebalance
        await this.alphabetizeJournalsInCategory(message.guild, targetCategory);
        await this.checkAndRebalanceJournals(message.guild);

    } catch (error) {
        console.error('Error ensuring user has journal:', error);
        // Don't throw error to avoid breaking the signup process
    }
},

async handleMyJournal(message) {
    const serverId = message.guild.id;
    const userId = message.author.id;

    try {
        // Check if user has a journal in this server
        const journalResult = await this.db.query(
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
                await this.db.query(
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
            await this.db.query(
                'DELETE FROM player_journals WHERE server_id = $1 AND user_id = $2',
                [serverId, userId]
            );
            return message.reply('📔 Your journal channel no longer exists. Ask a moderator to create a new one with `Wolf.journal @yourname`.');
        }

    } catch (error) {
        console.error('Error finding user journal:', error);
        await message.reply('❌ An error occurred while looking for your journal.');
    }
},

async handleRenameJournal(message, args) {
    const serverId = message.guild.id;
    const userId = message.author.id;

    try {
        // Check if user has a journal in this server
        const journalResult = await this.db.query(
            'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
            [serverId, userId]
        );

        if (journalResult.rows.length === 0) {
            return message.reply('📔 You don\'t have a journal yet. Ask a moderator to create one for you with `Wolf.journal @yourname`.');
        }

        const channelId = journalResult.rows[0].channel_id;

        // Verify the channel still exists
        let journalChannel;
        try {
            journalChannel = await message.guild.channels.fetch(channelId);
            if (!journalChannel) {
                // Channel was deleted, remove from database
                await this.db.query(
                    'DELETE FROM player_journals WHERE server_id = $1 AND user_id = $2',
                    [serverId, userId]
                );
                return message.reply('📔 Your journal channel no longer exists. Ask a moderator to create a new one with `Wolf.journal @yourname`.');
            }
        } catch (error) {
            // Channel doesn't exist, remove from database
            await this.db.query(
                'DELETE FROM player_journals WHERE server_id = $1 AND user_id = $2',
                [serverId, userId]
            );
            return message.reply('📔 Your journal channel no longer exists. Ask a moderator to create a new one with `Wolf.journal @yourname`.');
        }

        // Check if user provided a new name
        if (!args || args.length === 0) {
            return message.reply('❌ Please provide a new name for your journal. Usage: `Wolf.rename_journal <new-name>`');
        }

        // Combine all args into a single name (in case user provided multiple words)
        let newName = args.join(' ').trim();

        // Remove the -journal suffix if the user included it
        if (newName.endsWith('-journal')) {
            newName = newName.slice(0, -8);
        }

        // Validate and format the name according to Discord channel naming rules
        // Convert to lowercase, replace spaces with dashes, remove invalid characters
        newName = newName.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-_]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        // Validate the name
        if (!newName || newName.length === 0) {
            return message.reply('❌ Invalid journal name. Please use only letters, numbers, dashes, and underscores.');
        }

        if (newName.length > 90) {
            return message.reply('❌ Journal name is too long. Please keep it under 90 characters.');
        }

        // Add -journal suffix
        const journalChannelName = `${newName}-journal`;

        // Check if a channel with this name already exists in the same category
        const existingChannel = message.guild.channels.cache.find(
            channel => channel.name === journalChannelName && 
                      channel.parent?.id === journalChannel.parent?.id &&
                      channel.id !== journalChannel.id
        );

        if (existingChannel) {
            return message.reply(`❌ A journal with the name "${journalChannelName}" already exists in this category.`);
        }

        // Rename the channel
        await journalChannel.setName(journalChannelName);

        const embed = new EmbedBuilder()
            .setTitle('📔 Journal Renamed')
            .setDescription(`Your journal has been renamed to: **${journalChannelName}**`)
            .setColor(0x00AE86);

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error renaming journal:', error);
        await message.reply('❌ An error occurred while renaming your journal.');
    }
},

async handleJournalPinPerms(message) {
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

    const failed = [];
    const serverId = message.guild.id;
    for (const journal of allJournalChannels) {
        // I'm sure this could be done with a single query for all player journal results but this command will only run once so performance doesn't seem that important
        const playerResult = await this.db.query(
            'SELECT user_id FROM player_journals WHERE server_id = $1 AND channel_id = $2',
            [serverId, journal.id]
        );
        if (playerResult.rows.length === 0) {
            failed.push(`\t${journal.name} has no user_id`);
        }
        else {
            const user_id = playerResult.rows[0].user_id;
            const member = await message.guild.members.fetch(user_id).catch(() => null);
            if (!member) {
                failed.push(`\t${journal.name} user ${user_id} not in server`);
            } else {
                await journal.permissionOverwrites.edit(member.id, {
                    [PIN_PERMISSION]: true
                });
            }
        }
    }

    if (failed.length > 0) {
        return message.reply(`❌ Failed for ${failed.length} Journals:\n${failed.join('\n')}`);
    } else {
        return message.reply('Success!');
    }
},

async handleFixJournals(message) {
    const serverId = message.guild.id;

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

    // Fetch all journals for this server from the database in one query
    const journalChannelIds = allJournalChannels.map(channel => channel.id);
    const allJournalsResult = await this.db.query(
        'SELECT channel_id, user_id FROM player_journals WHERE server_id = $1 AND channel_id = ANY($2)',
        [serverId, journalChannelIds]
    );

    // Create a map of channel_id -> user_id for quick lookup
    const journalMap = new Map();
    for (const row of allJournalsResult.rows) {
        journalMap.set(row.channel_id, row.user_id);
    }

    // Send initial progress message
    const progressMsg = await message.reply(`🔍 Found ${allJournalChannels.length} journal channels. Starting to fix permissions...`);

    const failed = [];
    let processedCount = 0;

    // Get roles for permissions
    const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');
    const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
    const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');
    const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
    const signedUpRole = message.guild.roles.cache.find(r => r.name === 'Signed Up');

    for (const journal of allJournalChannels) {
        processedCount++;
        try {
            // Look up the journal owner from the map
            const userId = journalMap.get(journal.id);
            let member = null;
            if (userId) {
                member = await message.guild.members.fetch(userId).catch(() => null);
            }
            if (!userId) {
                failed.push(`\t${journal.name} has no user_id mapping in player_journals`);
                await progressMsg.edit(`🔍 Processing journal ${processedCount}/${allJournalChannels.length}... ⚠️ ${journal.name} has no user_id mapping`);
            } else if (!member) {
                failed.push(`\t${journal.name} user ${userId} not in server`);
                await progressMsg.edit(`🔍 Processing journal ${processedCount}/${allJournalChannels.length}... ⚠️ ${journal.name} user not found`);
            }

            // Update progress message every 10 journals or for the first few
            if (processedCount <= 5 || processedCount % 10 === 0 || processedCount === allJournalChannels.length) {
                await progressMsg.edit(`🔍 Processing journal ${processedCount}/${allJournalChannels.length}: ${journal.name}...`);
            }

            // Everyone: can see but not send
            await journal.permissionOverwrites.edit(message.guild.roles.everyone, {
                ViewChannel: true,
                SendMessages: false
            });

            // Alive: cannot see
            if (aliveRole) {
                await journal.permissionOverwrites.edit(aliveRole, {
                    ViewChannel: false,
                    SendMessages: false
                });
            }

            // Signed Up: cannot see
            if (signedUpRole) {
                await journal.permissionOverwrites.edit(signedUpRole, {
                    ViewChannel: false,
                    SendMessages: false
                });
            }

            // Journal owner: can see and write (skip if user not found)
            if (member) {
                await journal.permissionOverwrites.edit(member.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
            }

            // Mods: can see and write (preserve moderator access)
            if (modRole) {
                await journal.permissionOverwrites.edit(modRole, {
                    ViewChannel: true,
                    SendMessages: true
                });
            }

            // Spectators: can see but not send (match creation logic)
            if (spectatorRole) {
                await journal.permissionOverwrites.edit(spectatorRole, {
                    ViewChannel: true,
                    SendMessages: false
                });
            }

            // Dead: can see but not send (match creation logic)
            if (deadRole) {
                await journal.permissionOverwrites.edit(deadRole, {
                    ViewChannel: true,
                    SendMessages: false
                });
            }

        } catch (error) {
            console.error(`Error fixing permissions for journal ${journal.id} (${journal.name}):`, error);
            failed.push(`\t${journal.name} encountered error: ${error.message || error}`);
            await progressMsg.edit(`🔍 Processing journal ${processedCount}/${allJournalChannels.length}... ❌ Error with ${journal.name}`);
        }
    }

    // Final status message
    if (failed.length > 0) {
        await progressMsg.edit(`⚠️ Completed with issues for ${failed.length} journals:\n${failed.join('\n')}`);
    } else {
        await progressMsg.edit(`✅ Successfully fixed permissions for all ${allJournalChannels.length} journal channels.`);
    }
},

async handleBalanceJournals(message) {
    const serverId = message.guild.id;

    // Check if user has moderator permissions
    if (!this.hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }

    try {
        // Send initial progress message
        let progressMsg = await message.reply('🔍 Scanning for journal categories and channels...');

        // Get all journal categories
        const journalCategories = message.guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory && 
            (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
        );

        if (journalCategories.size === 0) {
            await progressMsg.edit('❌ No journal categories found. Create some journals first with `Wolf.journal @user`.');
            return;
        }

        await progressMsg.edit(`🔍 Found ${journalCategories.size} journal category/categories. Collecting journal channels...`);

        // Get all journal channels from all categories
        const allJournalChannels = [];
        for (const category of journalCategories.values()) {
            const categoryChannels = message.guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            allJournalChannels.push(...categoryChannels.values());
        }

        if (allJournalChannels.length === 0) {
            await progressMsg.edit('❌ No journal channels found in any journal categories.');
            return;
        }

        await progressMsg.edit(`📚 Found ${allJournalChannels.length} journal channels. Sorting alphabetically...`);

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
            await progressMsg.edit(`📚 Organizing ${totalJournals} journals in single category...`);
            await this.alphabetizeJournalsInCategory(message.guild, journalCategories.first());
            await progressMsg.edit(`✅ Journals are already properly organized! Found ${totalJournals} journals in a single category. All journals have been alphabetized.`);
            return;
        }

        // We need to split into multiple categories (50+ journals, including exactly 50)
        // This ensures we stay well under the Discord limit
        // For exactly 50 journals, we split into 2 categories of 25 each
        const numCategoriesNeeded = totalJournals >= maxChannelsPerCategory ? Math.max(2, Math.ceil(totalJournals / maxChannelsPerCategory)) : 1;

        // We need to split into multiple categories
        const journalsPerCategory = Math.ceil(totalJournals / numCategoriesNeeded);
        
        await progressMsg.edit(`📚 Need to split ${totalJournals} journals into ${numCategoriesNeeded} categories. Creating/updating categories...`);
        
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
                await progressMsg.edit(`📝 Renaming "Journals" category to "${categoryName}"...`);
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
                    await progressMsg.edit(`📝 Creating category "${categoryName}" (${i + 1}/${numCategoriesNeeded})...`);
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
        
        await progressMsg.edit(`📦 Moving journals to their appropriate categories...`);
        
        for (let i = 0; i < numCategoriesNeeded; i++) {
            const startIndex = i * journalsPerCategory;
            const endIndex = Math.min((i + 1) * journalsPerCategory, totalJournals);
            const categoryJournals = allJournalChannels.slice(startIndex, endIndex);
            
            await progressMsg.edit(`📦 Moving journals to category "${newCategories[i].name}" (${i + 1}/${numCategoriesNeeded})...`);
            
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
        
        if (movedCount > 0) {
            await progressMsg.edit(`📦 Moved ${movedCount} journals. Waiting for Discord to process moves...`);
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
                    await progressMsg.edit(`⏳ Waiting for Discord to process journal moves... (${attempts}/${maxAttempts} seconds)`);
                }
            }
            
            if (allMovesConfirmed) {
                console.log(`✅ All journal moves confirmed, restoring permissions...`);
                await progressMsg.edit(`🔐 Restoring permissions for ${movedJournals.length} moved journals...`);
                
                let restoredCount = 0;
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
                        restoredCount++;
                        // Update progress every 10 journals or for the first few
                        if (restoredCount <= 5 || restoredCount % 10 === 0 || restoredCount === movedJournals.length) {
                            await progressMsg.edit(`🔐 Restoring permissions... (${restoredCount}/${movedJournals.length} journals)`);
                        }
                        console.log(`✅ Restored permissions for journal channel: ${movedJournal.journal.name}`);
                    } catch (permissionError) {
                        console.error(`⚠️ Warning: Could not restore permissions for journal channel ${movedJournal.journal.name}:`, permissionError);
                    }
                }
            } else {
                console.warn(`⚠️ Not all journal moves were confirmed after ${maxAttempts} attempts`);
                await progressMsg.edit(`⚠️ Not all journal moves were confirmed after ${maxAttempts} attempts. Continuing anyway...`);
            }
        }
        
        // Alphabetize journals within each category
        await progressMsg.edit(`🔤 Alphabetizing journals within each category...`);
        for (let i = 0; i < numCategoriesNeeded; i++) {
            await progressMsg.edit(`🔤 Alphabetizing journals in "${newCategories[i].name}" (${i + 1}/${numCategoriesNeeded})...`);
            await this.alphabetizeJournalsInCategory(message.guild, newCategories[i]);
        }

        // Clean up old empty categories (except the original 'Journals' category)
        await progressMsg.edit(`🧹 Cleaning up empty categories...`);
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

        await progressMsg.edit({ embeds: [embed] });

    } catch (error) {
        console.error('Error balancing journals:', error);
        await message.reply('❌ An error occurred while balancing journals.');
    }
},

async alphabetizeJournalsInCategory(guild, category) {
    if (!category || category.children?.cache.size === 0) return;

    const journalChannels = category.children.cache.filter(
        channel => channel.name.endsWith('-journal')
    );

    if (journalChannels.size === 0) return;

    // Sort journals alphabetically
    const sortedJournals = journalChannels.sort((a, b) => {
        const nameA = a.name.replace('-journal', '').toLowerCase();
        const nameB = b.name.replace('-journal', '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    // Move journals to their correct positions
    let position = 0;
    for (const journal of sortedJournals.values()) {
        if (journal.position !== position) {
            await journal.setPosition(position);
        }
        position++;
    }
},

async handlePopulateJournals(message, args) {
    if (process.env.NODE_ENV !== 'development') {
        return message.reply('❌ This command is only available in development mode.');
    }

    // Parse number of journals to create (default 50 if not specified)
    let numJournals = 50;
    if (args.length > 0) {
        const parsed = parseInt(args[0]);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
            numJournals = parsed;
        } else {
            return message.reply('❌ Please specify a number between 1 and 100. Usage: `Wolf.populate_journals [number]`');
        }
    }

    try {
        // Find or create the "Journals" category
        let journalsCategory = message.guild.channels.cache.find(
            channel => channel.type === ChannelType.GuildCategory && channel.name === 'Journals'
        );

        if (!journalsCategory) {
            // Create the Journals category
            journalsCategory = await message.guild.channels.create({
                name: 'Journals',
                type: ChannelType.GuildCategory,
            });
        }

        // Get roles for permissions
        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');
        const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');

        const createdChannels = [];
        const failedChannels = [];

        // Create test journals with random letter prefixes for better testing
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let i = 1; i <= numJournals; i++) {
            try {
                // Generate a random letter prefix
                const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                const testName = `${randomLetter}TestUser${i.toString().padStart(3, '0')}`;
                const journalChannelName = `${testName.toLowerCase()}-journal`;

                // Check if journal already exists
                const existingJournal = message.guild.channels.cache.find(
                    channel => channel.name === journalChannelName && channel.parent?.id === journalsCategory.id
                );

                if (existingJournal) {
                    failedChannels.push(`${testName} (already exists)`);
                    continue;
                }

                // Create the journal channel
                const journalChannel = await message.guild.channels.create({
                    name: journalChannelName,
                    type: ChannelType.GuildText,
                    parent: journalsCategory.id,
                    permissionOverwrites: [
                        {
                            id: message.guild.roles.everyone.id,
                            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                        },
                        ...(modRole ? [{
                            id: modRole.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                            deny: [PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                        }] : []),
                        ...(spectatorRole ? [{
                            id: spectatorRole.id,
                            allow: [PermissionFlagsBits.ViewChannel],
                            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                        }] : []),
                        ...(deadRole ? [{
                            id: deadRole.id,
                            allow: [PermissionFlagsBits.ViewChannel],
                            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                        }] : [])
                    ],
                });

                // Send initial message to the journal
                const embed = new EmbedBuilder()
                    .setTitle(`📔 ${testName}'s Journal`)
                    .setDescription(`This is a test journal for ${testName}.\n\nThis journal was created for testing the journal balancing system.`)
                    .setColor(0x8B4513)
                    .setTimestamp();

                await journalChannel.send({ embeds: [embed] });

                createdChannels.push(testName);
                
                // Add a small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`Error creating test journal ${i}:`, error);
                const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                failedChannels.push(`${randomLetter}TestUser${i.toString().padStart(3, '0')} (error: ${error.message})`);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('🧪 Test Journals Created')
            .setDescription(`Created ${createdChannels.length} test journals for testing the balance system.`)
            .addFields(
                { name: 'Successfully Created', value: createdChannels.length.toString(), inline: true },
                { name: 'Failed', value: failedChannels.length.toString(), inline: true },
                { name: 'Total Requested', value: numJournals.toString(), inline: true }
            )
            .setColor(0x00AE86);

        if (failedChannels.length > 0) {
            embed.addFields({
                name: 'Failed Journals',
                value: failedChannels.slice(0, 10).join('\n') + (failedChannels.length > 10 ? `\n... and ${failedChannels.length - 10} more` : ''),
                inline: false
            });
        }

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error populating journals:', error);
        await message.reply('❌ An error occurred while creating test journals.');
    }
},

async findAppropriateJournalCategory(guild, displayName) {
    try {
        // Get all journal categories
        const journalCategories = guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory && 
            (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
        );

        if (journalCategories.size === 0) {
            return null; // No categories exist yet
        }

        // Get all journal channels from all categories
        const allJournalChannels = [];
        for (const category of journalCategories.values()) {
            const categoryChannels = guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            allJournalChannels.push(...categoryChannels.values());
        }

        // If we have one category with room, use it (avoid returning renamed "Journals" when we already split)
        if (allJournalChannels.length < 50 && journalCategories.size === 1) {
            return journalCategories.first();
        }

        // Sort all journals alphabetically
        allJournalChannels.sort((a, b) => {
            const nameA = a.name.replace('-journal', '').toLowerCase();
            const nameB = b.name.replace('-journal', '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Find where the new journal would fit alphabetically
        const newJournalName = displayName.toLowerCase().replace(/\s+/g, '-');
        let insertIndex = 0;
        for (let i = 0; i < allJournalChannels.length; i++) {
            const existingName = allJournalChannels[i].name.replace('-journal', '').toLowerCase();
            if (newJournalName.localeCompare(existingName) > 0) {
                insertIndex = i + 1;
            } else {
                break;
            }
        }

        // Calculate which category this journal would belong to
        const maxChannelsPerCategory = 50;
        const numCategoriesNeeded = Math.max(2, Math.ceil((allJournalChannels.length + 1) / maxChannelsPerCategory));
        const journalsPerCategory = Math.ceil((allJournalChannels.length + 1) / numCategoriesNeeded);
        const targetCategoryIndex = Math.floor(insertIndex / journalsPerCategory);

        const getChannelCount = (category) => guild.channels.cache.filter(
            ch => ch.parent?.id === category.id && ch.name.endsWith('-journal')
        ).size;

        // Find the appropriate category
        let chosenCategory = null;
        if (targetCategoryIndex === 0) {
            // First category - could be "Journals" or "Journals (A-L)"
            chosenCategory = journalCategories.find(cat =>
                cat.name === 'Journals' || cat.name.startsWith('Journals (A-')
            );
        } else {
            // Find category by index
            const sortedCategories = [...journalCategories.values()].sort((a, b) =>
                a.name.localeCompare(b.name)
            );
            if (targetCategoryIndex < sortedCategories.length) {
                chosenCategory = sortedCategories[targetCategoryIndex];
            }
        }

        // Never return a category that's already at the Discord limit (50)
        if (chosenCategory && getChannelCount(chosenCategory) >= maxChannelsPerCategory) {
            chosenCategory = [...journalCategories.values()].find(cat => getChannelCount(cat) < maxChannelsPerCategory) || chosenCategory;
        }
        if (chosenCategory) return chosenCategory;

        // Fallback to first category with room, or main Journals
        return [...journalCategories.values()].find(cat => getChannelCount(cat) < maxChannelsPerCategory)
            || journalCategories.find(cat => cat.name === 'Journals');

    } catch (error) {
        console.error('Error finding appropriate journal category:', error);
        // Fallback to main Journals category
        return guild.channels.cache.find(
            channel => channel.type === ChannelType.GuildCategory && channel.name === 'Journals'
        );
    }
},

async checkAndProactivelySplitJournals(guild, message = null) {
    try {
        // Get all journal categories
        const journalCategories = guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory && 
            (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
        );

        if (journalCategories.size === 0) {
            return false; // No journal categories exist yet
        }

        // Get all journal channels from all categories
        const allJournalChannels = [];
        for (const category of journalCategories.values()) {
            const categoryChannels = guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            allJournalChannels.push(...categoryChannels.values());
        }

        const totalJournals = allJournalChannels.length;
        const maxChannelsPerCategory = 50;
        const thresholdForSplitting = 49; // Split when we're about to hit the limit

        // Check if we're approaching the threshold
        if (totalJournals >= thresholdForSplitting) {
            // Calculate how many categories we'll need after adding one more journal
            const futureTotalJournals = totalJournals + 1;
            const numCategoriesNeeded = futureTotalJournals >= maxChannelsPerCategory ? Math.max(2, Math.ceil(futureTotalJournals / maxChannelsPerCategory)) : 1;
            
            // Check if we need to split (if we'll have more categories than we currently do)
            const currentNumCategories = journalCategories.size;
            
            if (numCategoriesNeeded > currentNumCategories) {
                // We need to split! Alert the user and proceed
                if (message) {
                    const alertEmbed = new EmbedBuilder()
                        .setTitle('⚠️ Journal Split Incoming')
                        .setDescription(`We're approaching the Discord channel limit (${totalJournals}/50 journals).\n\n**Splitting journals into ${numCategoriesNeeded} categories to maintain organization...**\n\nThis will take a moment. Please wait.`)
                        .addFields(
                            { name: 'Current Journals', value: totalJournals.toString(), inline: true },
                            { name: 'New Categories', value: numCategoriesNeeded.toString(), inline: true }
                        )
                        .setColor(0xFFA500)
                        .setTimestamp();

                    await message.reply({ embeds: [alertEmbed] });
                }

                console.log(`⚠️ Proactively splitting ${totalJournals} journals into ${numCategoriesNeeded} categories to prevent hitting Discord limit...`);
                
                // Perform the split using the existing rebalancing logic
                await this.performJournalRebalancing(guild, allJournalChannels, journalCategories);
                
                return true; // Split was performed
            }
        }

        return false; // No split needed
    } catch (error) {
        console.error('Error in checkAndProactivelySplitJournals:', error);
        return false;
    }
},

async performJournalRebalancing(guild, allJournalChannels, journalCategories) {
    // Sort journals alphabetically
    allJournalChannels.sort((a, b) => {
        const nameA = a.name.replace('-journal', '').toLowerCase();
        const nameB = b.name.replace('-journal', '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    const totalJournals = allJournalChannels.length;
    const maxChannelsPerCategory = 50;
    const thresholdForSplitting = 49; // Split at 49 so adding one more doesn't hit the 50 limit

    // If we have fewer than 49 journals, just alphabetize in current structure (no split needed)
    if (totalJournals < thresholdForSplitting) {
        // Find the main Journals category
        const mainCategory = journalCategories.find(cat => cat.name === 'Journals');
        if (mainCategory) {
            await this.alphabetizeJournalsInCategory(guild, mainCategory);
        }
        return;
    }

    // We need to split into multiple categories (49+ journals so we don't hit 50 in one category)
    // At 49 we split into 2 categories (25 + 24); at 50+ we split accordingly
    const numCategoriesNeeded = Math.max(2, Math.ceil(totalJournals / maxChannelsPerCategory));
    const journalsPerCategory = Math.ceil(totalJournals / numCategoriesNeeded);

    // Check if we need to rebalance (if any category has more than the target number)
    let needsRebalancing = false;
    for (const category of journalCategories.values()) {
        const categoryChannels = guild.channels.cache.filter(
            channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
        );
        if (categoryChannels.size > journalsPerCategory) {
            needsRebalancing = true;
            break;
        }
    }

    // If any category is over the limit, we need to rebalance
    for (const category of journalCategories.values()) {
        const categoryChannels = guild.channels.cache.filter(
            channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
        );
        if (categoryChannels.size > maxChannelsPerCategory) {
            needsRebalancing = true;
            break;
        }
    }

    if (!needsRebalancing) {
        return; // No rebalancing needed
    }

    console.log(`🔄 Rebalancing ${totalJournals} journals into ${numCategoriesNeeded} categories...`);

    // Handle category creation/renaming for proper alphabetical order
    const newCategories = [];
    
    // Find the original "Journals" category (used for rename + as source for permissions on new categories)
    const originalJournalsCategory = guild.channels.cache.find(
        channel => channel.type === ChannelType.GuildCategory && channel.name === 'Journals'
    );
    // Capture permission overwrites to copy to any newly created categories (so they don't start with no permissions)
    const categoryPermissionOverwrites = (originalJournalsCategory ?? journalCategories.values().next().value)
        ?.permissionOverwrites?.cache?.map(overwrite => ({
            id: overwrite.id,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield,
        })) ?? [];

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
            category = guild.channels.cache.find(
                channel => channel.type === ChannelType.GuildCategory && channel.name === categoryName
            );
            
            if (!category) {
                // Create new category, copying permissions from the original Journals category so the category isn't left with no permissions
                category = await guild.channels.create({
                    name: categoryName,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: categoryPermissionOverwrites,
                });
                
                // Position it after the previous category (which is now properly named)
                if (i > 0 && newCategories[i - 1]) {
                    await category.setPosition(newCategories[i - 1].position + 1);
                }
            }
        }
        
        newCategories.push(category);
    }

    // Move journals to their appropriate categories
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
            await guild.channels.fetch();
            
            // Check if all moves have been processed
            allMovesConfirmed = true;
            for (const movedJournal of movedJournals) {
                const refreshedJournal = guild.channels.cache.get(movedJournal.journal.id);
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
            
            // Now restore permissions for all moved journals using fresh references
            for (const movedJournal of movedJournals) {
                try {
                    // Get a fresh reference to the channel after the move
                    const freshJournal = guild.channels.cache.get(movedJournal.journal.id);
                    if (!freshJournal) {
                        console.warn(`⚠️ Could not find fresh reference for journal ${movedJournal.journal.name}`);
                        continue;
                    }
                    
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
                            await freshJournal.permissionOverwrites.edit(id, permissionData);
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
        await this.alphabetizeJournalsInCategory(guild, newCategories[i]);
    }

    // Clean up old empty categories (except the original 'Journals' category)
    for (const category of journalCategories.values()) {
        if (category.name !== 'Journals' && category.children?.cache.size === 0) {
            await category.delete();
        }
    }

    console.log(`✅ Rebalanced ${totalJournals} journals: moved ${movedCount} journals into ${numCategoriesNeeded} categories`);
},

async checkAndRebalanceJournals(guild) {
    try {
        // Get all journal categories
        const journalCategories = guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory && 
            (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
        );

        if (journalCategories.size === 0) {
            return; // No journal categories exist yet
        }

        // Get all journal channels from all categories
        const allJournalChannels = [];
        for (const category of journalCategories.values()) {
            const categoryChannels = guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            allJournalChannels.push(...categoryChannels.values());
        }

        if (allJournalChannels.length === 0) {
            return; // No journal channels exist
        }

        // Use the extracted rebalancing logic
        await this.performJournalRebalancing(guild, allJournalChannels, journalCategories);

    } catch (error) {
        console.error('Error in checkAndRebalanceJournals:', error);
        // Don't throw error to avoid breaking journal creation
    }
},

async handleJournalLink(message) {
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
        const existingJournals = await this.db.query(
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
                
                const displayNameScore = this.calculateSimilarity(journalBaseName, displayName);
                const usernameScore = this.calculateSimilarity(journalBaseName, username);
                
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
                await this.db.query(
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
                
                await this.db.query(
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
},

async handleJournalOwner(message) {
    const serverId = message.guild.id;
    const channelId = message.channel.id;

    try {
        // Check if this channel is a journal
        const journalResult = await this.db.query(
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
},

async handleJournalUnlink(message) {
    const serverId = message.guild.id;
    const channelId = message.channel.id;

    try {
        // Check if this channel is a journal
        const journalResult = await this.db.query(
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
        await this.db.query(
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
},

async handleJournalAssign(message, args) {
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
        const existingJournalResult = await this.db.query(
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
        const existingUserJournalResult = await this.db.query(
            'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
            [serverId, targetUser.id]
        );

        if (existingUserJournalResult.rows.length > 0) {
            const existingChannelId = existingUserJournalResult.rows[0].channel_id;
            return message.reply(`❌ **${targetMember.displayName || targetUser.username}** already has a journal linked: <#${existingChannelId}>. Use \`Wolf.journal_unlink\` in their current journal first.`);
        }

        // Create the journal assignment
        await this.db.query(
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
},

};
