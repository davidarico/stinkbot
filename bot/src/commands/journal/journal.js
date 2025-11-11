const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

const PIN_PERMISSION = 0x0008000000000000;

module.exports = {
    name: 'journal',
    playerCommand: false,
    async execute(bot, message, args) {
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
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 ORDER BY game_number DESC LIMIT 1',
            [serverId]
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No games found. Please create a game first.');
        }

        const game = gameResult.rows[0];

        try {
            // Proactively check if we need to split journals before creating a new one
            const splitPerformed = await bot.checkAndProactivelySplitJournals(message.guild, message);

            // Find the appropriate journal category for this user (may have changed after split)
            let targetCategory = await bot.findAppropriateJournalCategory(message.guild, targetMember.displayName);

            if (!targetCategory) {
                // Create the main Journals category if no categories exist
                targetCategory = await message.guild.channels.create({
                    name: 'Journals',
                    type: ChannelType.GuildCategory,
                });

                // Position it under the current game but above other games
                try {
                    const currentGameCategory = await bot.client.channels.fetch(game.category_id);
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
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PIN_PERMISSION],
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
                .setDescription(`Welcome to your personal journal, ${targetMember.displayName}!\n\nThis is your private space to:\n• Take notes during the game\n• Ask questions to the moderators\n• Record your thoughts and observations\n\n**Permissions:**\n• **You** can read and write\n• **Moderators** can read and write\n• **Spectators** can read only`)
                .setColor(0x8B4513)
                .setTimestamp();

            await journalChannel.send({ embeds: [embed] });

            // Ping the user to notify them of their new journal
            await journalChannel.send(`${targetMember} - Your journal has been created! 📔`);

            // Save journal to database
            await bot.db.query(
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
            await bot.alphabetizeJournalsInCategory(message.guild, targetCategory);
            await bot.checkAndRebalanceJournals(message.guild);

        } catch (error) {
            console.error('Error creating journal:', error);
            await message.reply('❌ An error occurred while creating the journal.');
        }
    }
};
