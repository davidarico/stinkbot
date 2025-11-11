const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'next',
    playerCommand: false,  // admin only
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        let newPhase, newDay;
        if (game.day_phase === 'day') {
            newPhase = 'night';
            newDay = game.day_number;
        } else {
            newPhase = 'day';
            newDay = game.day_number + 1;
        }

        // Before clearing votes when switching to night, get voting results
        let votingResults = null;
        if (game.day_phase === 'day') {
            // Get voting results before clearing
            const votesResult = await bot.db.query(
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

            votingResults = votesResult.rows;

            // Clear all votes for the game at the end of each day
            await bot.db.query(
                'DELETE FROM votes WHERE game_id = $1',
                [game.id]
            );

            // Clear voting message ID since we'll need a new voting message for the next day
            await bot.db.query(
                'UPDATE games SET voting_message_id = NULL WHERE id = $1',
                [game.id]
            );
        }

        // Update game phase with explicit UTC timestamp
        await bot.db.query(
            'UPDATE games SET day_phase = $1, day_number = $2, phase_change_at = $3 WHERE id = $4',
            [newPhase, newDay, new Date().toISOString(), game.id]
        );

        // Use custom messages or defaults
        const phaseMessage = newPhase === 'day' ? game.day_message : game.night_message;

        const title = newPhase === 'day' ? '🌞 Day Time!' : '🌙 Night Time!';

        // Standard embed for all channels (without voting results)
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(`It is now **${newPhase} ${newDay}**.\n\n${phaseMessage}`)
            .setColor(newPhase === 'day' ? 0xF1C40F : 0x2C3E50);

        // Post phase change message to all game channels
        const gameChannelIds = [
            game.town_square_channel_id
        ].filter(id => id); // Filter out any null/undefined channel IDs

        // Get additional channels created with add_channel command with their custom messages
        const additionalChannels = await bot.db.query(
            'SELECT channel_id, day_message, night_message FROM game_channels WHERE game_id = $1',
            [game.id]
        );

        // Send the phase change message to main game channels (voting booth, wolf chat, town square)
        const mainChannelPromises = gameChannelIds.map(async (channelId) => {
            try {
                const channel = await bot.client.channels.fetch(channelId);
                if (channel) {
                    await channel.send({ embeds: [embed] });
                }
            } catch (error) {
                console.error(`Error sending phase message to main channel ${channelId}:`, error);
            }
        });

        // Send custom messages to additional channels
        const additionalChannelPromises = additionalChannels.rows.map(async (channelData) => {
            try {
                const channel = await bot.client.channels.fetch(channelData.channel_id);
                if (channel) {
                    // Use channel-specific message if set, otherwise use default
                    const customMessage = newPhase === 'day'
                        ? (channelData.day_message || game.day_message)
                        : (channelData.night_message || game.night_message);

                    // Standard embed for custom channels (without voting results)
                    const customEmbed = new EmbedBuilder()
                        .setTitle(title)
                        .setDescription(`It is now **${newPhase} ${newDay}**.\n\n${customMessage}`)
                        .setColor(newPhase === 'day' ? 0xF1C40F : 0x2C3E50);

                    await channel.send({ embeds: [customEmbed] });
                }
            } catch (error) {
                console.error(`Error sending custom phase message to channel ${channelData.channel_id}:`, error);
            }
        });

        // Wait for all channel messages to be sent
        await Promise.all([...mainChannelPromises, ...additionalChannelPromises]);

        // Send wolf-specific message to wolf chat if set
        if (game.wolf_chat_channel_id && (game.wolf_day_message || game.wolf_night_message)) {
            const wolfMessage = newPhase === 'day' ? game.wolf_day_message : game.wolf_night_message;

            if (wolfMessage) {
                try {
                    const wolfChannel = await bot.client.channels.fetch(game.wolf_chat_channel_id);
                    if (wolfChannel) {
                        const wolfEmbed = new EmbedBuilder()
                            .setTitle(title)
                            .setDescription(`It is now **${newPhase} ${newDay}**.\n\n${wolfMessage}`)
                            .setColor(newPhase === 'day' ? 0xF1C40F : 0x2C3E50);

                        await wolfChannel.send({ embeds: [wolfEmbed] });
                    }
                } catch (error) {
                    console.error(`Error sending wolf phase message to wolf chat:`, error);
                }
            }
        }


        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        // If it's a new day, create new voting message and allow voting
        const votingChannel = await bot.client.channels.fetch(game.voting_booth_channel_id);
        if (newPhase === 'day') {
            // Only create a new voting message for day 2+ (day 1 doesn't have voting)
            if (newDay >= 2) {
                console.log(`[DEBUG] Creating voting message for Day ${newDay} in game ${game.id}`);
                await bot.createVotingMessage(game.id, votingChannel);
            }

            // Allow voting during day phase (but only for day 2+)
            if (newDay >= 2) {
                await votingChannel.permissionOverwrites.edit(aliveRole.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
            } else {
                // Day 1 - keep voting booth read-only
                await votingChannel.permissionOverwrites.edit(aliveRole.id, {
                    ViewChannel: true,
                    SendMessages: false
                });
            }
        }
        else {
            // Close voting booth channel for the night phase
            await votingChannel.permissionOverwrites.edit(aliveRole.id, {
                ViewChannel: true,
                SendMessages: false
            });
        }

        // Handle game channel permissions based on open_at_dawn and open_at_dusk flags
        try {
            // Get all game channels for this game
            const gameChannelsResult = await bot.db.query(
                'SELECT channel_id, open_at_dawn, open_at_dusk FROM game_channels WHERE game_id = $1',
                [game.id]
            );

            for (const channelData of gameChannelsResult.rows) {
                try {
                    const channel = await bot.client.channels.fetch(channelData.channel_id);
                    if (!channel) {
                        console.log(`[DEBUG] Channel ${channelData.channel_id} not found, skipping permission update`);
                        continue;
                    }

                    let shouldAllowSendMessages = false;

                    if (newPhase === 'day') {
                        // During day phase, check open_at_dawn flag
                        shouldAllowSendMessages = channelData.open_at_dawn;
                    } else {
                        // During night phase, check open_at_dusk flag
                        shouldAllowSendMessages = channelData.open_at_dusk;
                    }

                    // Update Alive role permissions for this channel
                    await channel.permissionOverwrites.edit(aliveRole.id, {
                        ViewChannel: false,
                        SendMessages: shouldAllowSendMessages
                    });

                    console.log(`[DEBUG] Updated channel ${channel.name} permissions: Alive role can send messages = ${shouldAllowSendMessages} (${newPhase} phase)`);
                } catch (error) {
                    console.error(`Error updating permissions for channel ${channelData.channel_id}:`, error);
                }
            }
        } catch (error) {
            console.error('Error handling game channel permissions:', error);
        }

        // Create separate voting results embed for the moderator who issued the command
        let modReplyEmbed = embed;
        let votingBoothEmbed = null; // Embed to send to voting booth

        if (newPhase === 'night' && votingResults && votingResults.length > 0) {
            const playersWithEnoughVotes = votingResults.filter(result => result.vote_count >= game.votes_to_hang);

            let votingResultsDescription = embed.data.description + '\n\n**📊 Day ' + game.day_number + ' Voting Results:**';

            if (playersWithEnoughVotes.length > 0) {
                votingResultsDescription += '\n\n**Players who surpassed the vote threshold (' + game.votes_to_hang + ' votes):**';
                playersWithEnoughVotes.forEach(result => {
                    votingResultsDescription += `\n• **${result.target_username}** - ${result.vote_count} votes`;
                });
            } else {
                votingResultsDescription += '\n\n*No players reached the vote threshold of ' + game.votes_to_hang + ' votes.*';
            }

            votingResultsDescription += '\n\n**Vote Breakdown:**';
            votingResults.forEach(result => {
                const voters = result.voters.split(', ').join(', ');
                votingResultsDescription += `\n• **${result.target_username}** (${result.vote_count}): ${voters}`;
            });

            modReplyEmbed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(votingResultsDescription)
                .setColor(newPhase === 'day' ? 0xF1C40F : 0x2C3E50);

            // Create voting booth embed with just the voting breakdown
            let votingBoothDescription = '';

            if (playersWithEnoughVotes.length > 0) {
                votingBoothDescription += '\n\n**Players who surpassed the vote threshold (' + game.votes_to_hang + ' votes):**';
                playersWithEnoughVotes.forEach(result => {
                    votingBoothDescription += `\n• **${result.target_username}** - ${result.vote_count} votes`;
                });
            } else {
                votingBoothDescription += '\n\n*No players reached the vote threshold of ' + game.votes_to_hang + ' votes.*';
            }

            votingBoothDescription += '\n\n**Vote Breakdown:**';
            votingResults.forEach(result => {
                const voters = result.voters.split(', ').join(', ');
                votingBoothDescription += `\n• **${result.target_username}** (${result.vote_count}): ${voters}`;
            });

            votingBoothEmbed = new EmbedBuilder()
                .setTitle(`📊 Day ${game.day_number} Voting Results`)
                .setDescription(votingBoothDescription)
                .setColor(0x2C3E50);

        } else if (newPhase === 'night' && (!votingResults || votingResults.length === 0)) {
            if (game.day_number > 1) { // Only show this message for day 2+ (when voting is actually possible)
                const votingResultsDescription = embed.data.description + '\n\n**📊 Day ' + game.day_number + ' Voting Results:**\n*No votes were cast today.*';
                modReplyEmbed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(votingResultsDescription)
                    .setColor(newPhase === 'day' ? 0xF1C40F : 0x2C3E50);

                // Create voting booth embed for no votes
                votingBoothEmbed = new EmbedBuilder()
                    .setTitle('📊 Final Vote Results')
                    .setDescription(`**📊 Day ${game.day_number} Voting Results:**\n*No votes were cast today.*`)
                    .setColor(0x2C3E50);
            }
        }

        // Send voting results to voting booth channel if switching to night and there are results to show
        if (newPhase === 'night' && votingBoothEmbed && game.day_number > 1) {
            try {
                await votingChannel.send({ embeds: [votingBoothEmbed] });
            } catch (error) {
                console.error('Error sending voting results to voting booth:', error);
            }
        }

        // Reply to the command user (moderator) with voting results if switching to night
        await message.reply({ embeds: [modReplyEmbed] });
    }
};
