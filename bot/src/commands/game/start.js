const { ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'start',
    playerCommand: false,  // admin only
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        // Get game in signup phase
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'signup']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No game in signup phase found.');
        }

        const game = gameResult.rows[0];
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');
        const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');

        // Check if there are players
        const playersResult = await bot.db.query(
            'SELECT COUNT(*) as count FROM players WHERE game_id = $1',
            [game.id]
        );

        if (parseInt(playersResult.rows[0].count) == 0) {
            return message.reply('❌ Need at least one player to start the game.');
        }

        // Get config for naming
        const configResult = await bot.db.query(
            'SELECT * FROM server_configs WHERE server_id = $1',
            [serverId]
        );
        const config = configResult.rows[0];

        // Create game channels in the specified order
        const category = await bot.client.channels.fetch(game.category_id);

        // Get signup channel to rename it later
        const signupChannel = await bot.client.channels.fetch(game.signup_channel_id);

        // 1. Breakdown is already created on Wolf.create and will be at the top of the category

        // 2. Results - Only Mod can type, everyone else can see but not type
        const results = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-results`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    deny: ['ViewChannel', 'SendMessages']
                },
                {
                    id: aliveRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: deadRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: spectatorRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: modRole.id,
                    allow: ['ViewChannel', 'SendMessages']
                }
            ]
        });
        await results.setPosition(signupChannel.position); // Position results above the signup channel

        // 3. Player-memos - Alive can see and type, Dead can see but not type, Spectators can see but not type, Mods can see and type
        const memos = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-player-memos`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    deny: ['ViewChannel', 'SendMessages']
                },
                {
                    id: aliveRole.id,
                    allow: ['ViewChannel', 'SendMessages']
                },
                {
                    id: deadRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: spectatorRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: modRole.id,
                    allow: ['ViewChannel', 'SendMessages']
                }
            ]
        });
        await memos.setPosition(results.position + 1); // Position memos below results

        // 4. Townsquare - Alive can see and type, Dead can see but not type, Spectators can see but not type, Mods can see and type
        const townSquare = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-townsquare`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    deny: ['ViewChannel', 'SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']
                },
                {
                    id: aliveRole.id,
                    allow: ['ViewChannel', 'SendMessages'],
                    deny: ['CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']
                },
                {
                    id: deadRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']
                },
                {
                    id: spectatorRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']
                },
                {
                    id: modRole.id,
                    allow: ['ViewChannel', 'SendMessages'],
                    deny: ['CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']
                }
            ]
        });
        await townSquare.setPosition(memos.position + 1); // Position town square below memos

        // 5. Voting-Booth (starts locked for night phase) - All can see but none can type initially
        const votingBooth = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-voting-booth`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    deny: ['ViewChannel', 'SendMessages']
                },
                {
                    id: aliveRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: deadRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: spectatorRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: modRole.id,
                    allow: ['ViewChannel', 'SendMessages']
                }
            ]
        });
        await votingBooth.setPosition(townSquare.position + 1); // Position voting booth below town square

        // 6. <added channels> will be positioned here when created with Wolf.add_channel

        // 7. Wolf-Chat - Mods can see and type, Spectators can see but not type, Alive cannot see but can type (for wolves), everyone else cannot see
        const wolfChat = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-wolf-chat`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    deny: ['ViewChannel', 'SendMessages']
                },
                {
                    id: modRole.id,
                    allow: ['ViewChannel', 'SendMessages']
                },
                {
                    id: spectatorRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: aliveRole.id,
                    deny: ['ViewChannel'],
                    allow: ['SendMessages']
                },
                {
                    id: deadRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
            ]
        });
        await wolfChat.setPosition(votingBooth.position + 1); // Position wolf chat below voting booth

        // Rename signup channel to dead-chat and apply dead chat permissions
        await signupChannel.setName(`${config.game_prefix}${game.game_number}-dead-chat`);

        // Apply dead chat permissions to the renamed signup channel
        // Dead can see and type, Alive cannot see, Spectators can see and type, Mods can see and type
        // <fletch> What's the point of removing @everyone access? </fletch>
        // await signupChannel.permissionOverwrites.edit(message.guild.roles.everyone.id, {
        //     ViewChannel: false,
        //     SendMessages: false
        // });
        await signupChannel.permissionOverwrites.edit(deadRole.id, {
            ViewChannel: true,
            SendMessages: true
        });
        // <fletch> Removing alive access is sufficient (tested) </fletch>
        await signupChannel.permissionOverwrites.edit(aliveRole.id, {
            ViewChannel: false
        });
        await signupChannel.permissionOverwrites.edit(spectatorRole.id, {
            ViewChannel: true,
            SendMessages: true
        });
        await signupChannel.permissionOverwrites.edit(modRole.id, {
            ViewChannel: true,
            SendMessages: true
        });

        // 8. Dead-Chat (already renamed above from signup channel)
        // All channels were positioned above it, there was no success trying to reposition it at this point

        // Update all signed up players to Alive role
        const signedUpPlayers = await bot.db.query(
            'SELECT user_id FROM players WHERE game_id = $1',
            [game.id]
        );

        try {
            await message.guild.members.fetch();
        } catch (error) {
            console.log('Could not fetch all guild members, falling back to individual fetches');
            // Fallback to original method if bulk fetch fails
            for (const player of signedUpPlayers.rows) {
                try {
                    const member = await message.guild.members.fetch(player.user_id);
                    await bot.removeRole(member, 'Signed Up');
                    await bot.assignRole(member, 'Alive');
                } catch (error) {
                    console.error(`Error updating role for player ${player.user_id}:`, error);
                }
            }
        }

        // Use cached members for much faster processing
        for (const player of signedUpPlayers.rows) {
            try {
                const member = message.guild.members.cache.get(player.user_id);
                if (member) {
                    await bot.removeRole(member, 'Signed Up');
                    await bot.assignRole(member, 'Alive');
                }
            } catch (error) {
                console.error(`Error updating role for player ${player.user_id}:`, error);
            }
        }

        // Channel permissions are now set during channel creation

        // Create channels for game_channels records where is_created is false
        try {
            const pendingChannelsResult = await bot.db.query(
                'SELECT channel_name, day_message, night_message, invited_users FROM game_channels WHERE game_id = $1 AND is_created = $2',
                [game.id, false]
            );

            for (const channelData of pendingChannelsResult.rows) {
                try {
                    // Create the channel with the same permissions as handleAddChannel
                    const newChannel = await message.guild.channels.create({
                        name: channelData.channel_name,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        permissionOverwrites: [
                            {
                                id: message.guild.roles.everyone.id,
                                deny: ['ViewChannel', 'SendMessages']
                            },
                            {
                                id: modRole.id,
                                allow: ['ViewChannel', 'SendMessages']
                            },
                            {
                                id: spectatorRole.id,
                                allow: ['ViewChannel'],
                                deny: ['SendMessages']
                            },
                            {
                                id: aliveRole.id,
                                deny: ['ViewChannel'],
                                allow: ['SendMessages']
                            }
                        ]
                    });

                    // Alive shouldnt see the channel at all but can send messages if open_at_dusk is true
                    await newChannel.permissionOverwrites.edit(aliveRole.id, {
                        ViewChannel: false,
                        SendMessages: channelData.open_at_dusk
                    });

                    // Position the channel between voting booth and wolf chat (same as handleAddChannel)
                    try {
                        const wolfChatChannel = category.children.cache.find(channel =>
                            channel.name.includes('-wolf-chat')
                        );

                        if (wolfChatChannel) {
                            await newChannel.setPosition(wolfChatChannel.position);
                            console.log(`Positioned new channel "${channelData.channel_name}" before wolf chat`);
                        }
                    } catch (positionError) {
                        console.error('Error positioning new channel:', positionError);
                    }

                    // Update the database record with the channel ID and mark as created
                    await bot.db.query(
                        'UPDATE game_channels SET channel_id = $1, is_created = $2 WHERE game_id = $3 AND channel_name = $4',
                        [newChannel.id, true, game.id, channelData.channel_name]
                    );

                    console.log(`[DEBUG] Created channel ${channelData.channel_name} with ID ${newChannel.id}`);
                } catch (error) {
                    console.error(`Error creating channel ${channelData.channel_name}:`, error);
                }
            }
        } catch (error) {
            console.error('Error creating pending game channels:', error);
        }

        // Add view permissions for invited users to their respective channels
        try {
            const channelsWithInvitesResult = await bot.db.query(
                'SELECT invited_users, channel_name, channel_id FROM game_channels WHERE game_id = $1 AND invited_users IS NOT NULL AND is_created = true',
                [game.id]
            );

            for (const channelData of channelsWithInvitesResult.rows) {
                if (channelData.invited_users && Array.isArray(channelData.invited_users)) {
                    // Get the channel object
                    const channel = await bot.client.channels.fetch(channelData.channel_id);
                    if (!channel) {
                        console.error(`[PERMISSIONS] Could not find channel ${channelData.channel_name} with ID ${channelData.channel_id}`);
                        continue;
                    }

                    for (const userId of channelData.invited_users) {
                        try {
                            // Check if user is in the server
                            let member;
                            try {
                                member = await message.guild.members.fetch(userId);
                            } catch (fetchError) {
                                console.log(`User ${userId} not found in server, skipping permission grant`);
                                continue;
                            }

                            // Add view permission for this user to the channel
                            await channel.permissionOverwrites.edit(userId, {
                                ViewChannel: true
                            });
                        } catch (permissionError) {
                            console.error(`Error adding view permission for user ${userId} to channel ${channelData.channel_name}:`, permissionError);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error processing invited user permissions:', error);
        }

        // Update game in database with explicit UTC timestamp
        await bot.db.query(
            `UPDATE games SET
                status = 'active',
                day_phase = 'night',
                day_number = 1,
                town_square_channel_id = $1,
                wolf_chat_channel_id = $2,
                memos_channel_id = $3,
                results_channel_id = $4,
                voting_booth_channel_id = $5,
                phase_change_at = $6
             WHERE id = $7`,
            [townSquare.id, wolfChat.id, memos.id, results.id, votingBooth.id, new Date().toISOString(), game.id]
        );

        // Send player list to dead chat
        await bot.sendPlayerListToDeadChat(game.id, signupChannel);

        // Send role assignments to player journals
        const journalNotificationResults = await bot.sendRoleNotificationsToJournals(game.id, serverId);

        const embed = new EmbedBuilder()
            .setTitle('🎮 Game Started!')
            .setDescription('All game channels have been created. The game has officially begun!\n\n🌙 **Night 1** - Wolves, make your moves!')
            .addFields(
                { name: 'Results', value: `<#${results.id}>`, inline: true },
                { name: 'Player Memos', value: `<#${memos.id}>`, inline: true },
                { name: 'Town Square', value: `<#${townSquare.id}>`, inline: true },
                { name: 'Voting Booth', value: `<#${votingBooth.id}>`, inline: true },
                { name: 'Wolf Chat', value: `<#${wolfChat.id}>`, inline: true },
                { name: 'Dead Chat', value: `<#${signupChannel.id}>`, inline: true }
            )
            .setColor(0x2C3E50);

        // Add journal notification summary if there were any issues
        if (journalNotificationResults.failed > 0 || journalNotificationResults.sent > 0 || journalNotificationResults.wolvesAddedToChat > 0) {
            let notificationSummary = `• ${journalNotificationResults.sent} players notified in journals`;
            if (journalNotificationResults.wolvesAddedToChat > 0) {
                notificationSummary += `\n• ${journalNotificationResults.wolvesAddedToChat} wolves added to wolf chat`;
            }
            if (journalNotificationResults.failed > 0) {
                notificationSummary += `\n• ${journalNotificationResults.failed} players failed to notify (no journal or no role assigned)`;
            }

            embed.addFields({
                name: '📔 Role Notifications',
                value: notificationSummary,
                inline: false
            });
        }

        await message.reply({ embeds: [embed] });
    }
};
