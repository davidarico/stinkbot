'use strict';

const { ChannelType, EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

module.exports = {

async handleNext(message) {
    const serverId = message.guild.id;

    // Get active game
    const gameResult = await this.db.query(
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
        const votesResult = await this.db.query(
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

        // Intentional: clear ALL votes for the game at phase change, not just today's.
        // The votes table is a live working set; historical vote data lives in the archive.
        await this.db.query(
            'DELETE FROM votes WHERE game_id = $1',
            [game.id]
        );
        
        // Clear voting message ID since we'll need a new voting message for the next day
        await this.db.query(
            'UPDATE games SET voting_message_id = NULL WHERE id = $1',
            [game.id]
        );
    }

    // Update game phase with explicit UTC timestamp
    await this.db.query(
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
    const additionalChannels = await this.db.query(
        'SELECT channel_id, day_message, night_message FROM game_channels WHERE game_id = $1',
        [game.id]
    );

    // Send the phase change message to main game channels (voting booth, wolf chat, town square)
    const mainChannelPromises = gameChannelIds.map(async (channelId) => {
        try {
            const channel = await this.client.channels.fetch(channelId);
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
            const channel = await this.client.channels.fetch(channelData.channel_id);
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
                const wolfChannel = await this.client.channels.fetch(game.wolf_chat_channel_id);
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
    const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
    if (newPhase === 'day') {
        // Only create a new voting message for day 2+ (day 1 doesn't have voting)
        if (newDay >= 2) {
            console.log(`[DEBUG] Creating voting message for Day ${newDay} in game ${game.id}`);
            await this.createVotingMessage(game.id, votingChannel);
        }

        // Allow voting during day phase (but only for day 2+)
        if (newDay >= 2) {
            await votingChannel.permissionOverwrites.edit(aliveRole.id, {
                SendMessages: true
            });
        } else {
            // Day 1 - keep voting booth read-only
            await votingChannel.permissionOverwrites.edit(aliveRole.id, {
                SendMessages: false
            });
        }
    }
    else {
        // Close voting booth channel for the night phase
        await votingChannel.permissionOverwrites.edit(aliveRole.id, {
            SendMessages: false
        });
    }

    // Handle game channel permissions based on open_at_dawn and open_at_dusk flags
    try {
        // Get all game channels for this game
        const gameChannelsResult = await this.db.query(
            'SELECT channel_id, open_at_dawn, open_at_dusk FROM game_channels WHERE game_id = $1',
            [game.id]
        );

        for (const channelData of gameChannelsResult.rows) {
            try {
                const channel = await this.client.channels.fetch(channelData.channel_id);
                if (!channel) {
                    console.log(`[DEBUG] Channel ${channelData.channel_id} not found, skipping permission update`);
                    continue;
                }

                let shouldAllowSendMessages = false;
                let shouldAllowAddReactions = false;
                
                if (newPhase === 'day') {
                    // During day phase, check open_at_dawn flag
                    shouldAllowSendMessages = channelData.open_at_dawn;
                    shouldAllowAddReactions = channelData.open_at_dawn;
                } else {
                    // During night phase, check open_at_dusk flag
                    shouldAllowSendMessages = channelData.open_at_dusk;
                    shouldAllowAddReactions = channelData.open_at_dusk;
                }

                // Update Alive role permissions for this channel
                await channel.permissionOverwrites.edit(aliveRole.id, {
                    SendMessages: shouldAllowSendMessages,
                    AddReactions: shouldAllowAddReactions
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
            .setTitle(`📊 Day ${game.day_number} votes → Night ${newDay}`)
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
                .setTitle(`📊 Day ${game.day_number} votes → Night ${newDay}`)
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
},

async handleEnd(message) {
    const serverId = message.guild.id;

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3)',
        [serverId, 'signup', 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    // Confirmation
    const embed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Game End')
        .setDescription('Are you sure you want to end the current game? This action cannot be undone.')
        .setColor(0xE74C3C);

    await message.reply({ embeds: [embed] });
    await message.reply('Type `confirm` to end the game or `cancel` to abort.');

    const filter = (m) => m.author.id === message.author.id && ['confirm', 'cancel'].includes(m.content.toLowerCase());
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });

    if (!collected.size || collected.first().content.toLowerCase() === 'cancel') {
        return message.reply('❌ Game end cancelled.');
    }

    const game = gameResult.rows[0];

    // Update game status
    await this.db.query(
        'UPDATE games SET status = $1 WHERE id = $2',
        ['ended', game.id]
    );

    // Reset all members to Spectator role
    let resetMembersCount = 0;
    const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
    try {
        if (spectatorRole) {
            // Fetch all members in the guild
            const members = await message.guild.members.fetch();
            
            for (const [memberId, member] of members) {
                // Skip bots
                if (member.user.bot) continue;
                
                try {
                    // Remove all game-related roles
                    await this.removeRole(member, 'Signed Up');
                    await this.removeRole(member, 'Alive');
                    await this.removeRole(member, 'Dead');
                    
                    // Assign Spectator role
                    await this.assignRole(member, 'Spectator');
                    resetMembersCount++;
                } catch (error) {
                    console.error(`Error resetting roles for member ${member.displayName}:`, error);
                }
            }
        } else {
            console.log('Spectator role not found - skipping member role reset');
        }
    } catch (error) {
        console.error('Error during member role reset:', error);
    }

    // Remove Alive role's typing permissions from all channels in the game category
    try {
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        if (aliveRole && game.category_id) {
            const category = await message.guild.channels.fetch(game.category_id);
            if (category) {
                // Get all channels in the game category
                const categoryChannels = category.children.cache.filter(
                    channel => channel.type === ChannelType.GuildText
                );
                
                let updatedChannelsCount = 0;
                for (const [channelId, channel] of categoryChannels) {
                    try {
                        // Remove SendMessages permission for Alive role while keeping ViewChannel if it exists
                        // <fletch> Once game ends, players should be able to view ALL channels except mod-chat
                        if (channel.name.indexOf("mod-chat") >= 0)
                            continue;

                        await channel.permissionOverwrites.edit(aliveRole.id, {
                            SendMessages: false,
                            ViewChannel: true
                        });                            
                        // Everyone should be able to see all non-mod channels once game has ended (should fix issue where SignedUp cannot see past games?)
                        await channel.permissionOverwrites.edit(message.guild.roles.everyone.id, {
                            ViewChannel: true
                            // Do not touch SendMessages, should be ok already since only Alive previously had access
                        });
                        // </fletch>
                        updatedChannelsCount++;
                        console.log(`Removed typing permissions for Alive role in channel: ${channel.name}`);
                    } catch (error) {
                        console.error(`Error updating permissions for channel ${channel.name}:`, error);
                    }
                }
                console.log(`Updated permissions for ${updatedChannelsCount} channels in game category`);
            } else {
                console.log('Game category not found - skipping channel permission updates');
            }
        } else {
            console.log('Alive role or category not found - skipping channel permission updates');
        }
    } catch (error) {
        console.error('Error updating channel permissions:', error);
    }

    const successEmbed = new EmbedBuilder()
        .setTitle('🏁 Game Ended')
        .setDescription('The game has been officially ended.')
        .setColor(0x95A5A6);

    await message.reply({ embeds: [successEmbed] });
},

async handleScuff(message) {
    const serverId = message.guild.id;

    // Get active game (scuff is intended to rewind an in-progress game back to signup)
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found to scuff.');
    }

    const game = gameResult.rows[0];

    const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Scuff')
        .setDescription(
            [
                'This command will **rewind the current game back to signups**.',
                '',
                '**It will:**',
                `- Set game **#${game.game_number}** \`status\` to \`signup\` and set \`signups_closed = false\``,
                '- For every member with the **Alive** role: remove **Alive** and add **Signed Up**',
                '',
                '**It will NOT do:**',
                '- Delete/recreate channels, rename channels, or undo any channel permission changes',
                '- Touch members with the **Dead** role (unless they also have Alive)',
                '',
                'Type `confirm` to proceed or `cancel` to abort.',
            ].join('\n')
        )
        .setColor(0xE67E22);

    await message.reply({ embeds: [confirmEmbed] });

    const filter = (m) =>
        m.author.id === message.author.id &&
        ['confirm', 'cancel'].includes(m.content.toLowerCase());
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });

    if (!collected.size || collected.first().content.toLowerCase() === 'cancel') {
        return message.reply('❌ Scuff cancelled.');
    }

    // Update game status back to signup and reopen signups
    await this.db.query(
        'UPDATE games SET status = $1, signups_closed = $2 WHERE id = $3',
        ['signup', false, game.id]
    );

    const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
    const signedUpRole = message.guild.roles.cache.find(r => r.name === 'Signed Up');

    if (!aliveRole || !signedUpRole) {
        return message.reply('⚠️ Game was set back to `signup`, but I could not find the `Alive` and/or `Signed Up` roles to update members.');
    }

    let processed = 0;
    let updated = 0;
    let failed = 0;

    try {
        await message.guild.members.fetch();
    } catch (error) {
        console.warn('[DEBUG] Could not fetch all guild members for scuff; using cached members only.');
    }

    const aliveMembers = message.guild.members.cache.filter(
        m => !m.user.bot && m.roles.cache.has(aliveRole.id)
    );

    for (const [, member] of aliveMembers) {
        processed++;
        try {
            if (member.roles.cache.has(aliveRole.id)) {
                await member.roles.remove(aliveRole);
            }
            if (!member.roles.cache.has(signedUpRole.id)) {
                await member.roles.add(signedUpRole);
            }
            // Keep behavior consistent with `Wolf.in` (signed up players are not spectators)
            await this.removeRole(member, 'Spectator');
            updated++;
        } catch (error) {
            failed++;
            console.error(`Error scuffing roles for member ${member.displayName}:`, error);
        }
    }

    await message.reply(
        `✅ Scuffed game #${game.game_number}: set status back to \`signup\` and updated roles for **${updated}/${processed}** Alive members` +
        (failed ? ` (**${failed}** failed)` : '') +
        '.'
    );
},

async handleRefresh(message) {
    if (process.env.NODE_ENV !== 'development') {
        return message.reply('❌ This command is only available in development mode.');
    }

    const serverId = message.guild.id;

    // Confirmation
    const embed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Server Refresh')
        .setDescription('Are you sure you want to refresh this server? This will:\n\n• Delete ALL text channels except #general\n• Delete ALL categories\n• Reset game counter to 1\n• End any active games\n• Reset all members to Spectator role\n\nThis action cannot be undone!')
        .setColor(0xE74C3C);

    await message.reply({ embeds: [embed] });
    await message.reply('Type `confirm` to refresh the server or `cancel` to abort.');

    const filter = (m) => m.author.id === message.author.id && ['confirm', 'cancel'].includes(m.content.toLowerCase());
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });

    if (!collected.size || collected.first().content.toLowerCase() === 'cancel') {
        return message.reply('❌ Server refresh cancelled.');
    }

    try {
        // Delete all text channels except 'general'
        const allChannels = await message.guild.channels.fetch();
        let deletedChannelsCount = 0;
        let deletedCategoriesCount = 0;

        for (const [channelId, channel] of allChannels) {
            try {
                // Delete all categories
                if (channel.type === ChannelType.GuildCategory) {
                    await channel.delete();
                    deletedCategoriesCount++;
                    console.log(`Deleted category: ${channel.name}`);
                }
                // Delete all text channels except 'general' and the private channel 'mod'
                else if (channel.type === ChannelType.GuildText && channel.name !== 'general' && channel.name !== 'mod') {
                    await channel.delete();
                    deletedChannelsCount++;
                    console.log(`Deleted text channel: ${channel.name}`);
                }
            } catch (error) {
                console.log(`Failed to delete channel ${channel.name}: ${error.message}`);
            }
        }

        // Clear database data for this server
        await this.db.query('DELETE FROM votes WHERE game_id IN (SELECT id FROM games WHERE server_id = $1)', [serverId]);
        await this.db.query('DELETE FROM game_channels WHERE game_id IN (SELECT id FROM games WHERE server_id = $1)', [serverId]);
        await this.db.query('DELETE FROM players WHERE game_id IN (SELECT id FROM games WHERE server_id = $1)', [serverId]);
        await this.db.query('DELETE FROM games WHERE server_id = $1', [serverId]);
        
        // Reset game counter to 1
        await this.db.query(
            'UPDATE server_configs SET game_counter = 1 WHERE server_id = $1',
            [serverId]
        );

        // Reset all members to Spectator role
        let resetMembersCount = 0;
        try {
            const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
            if (spectatorRole) {
                // Fetch all members in the guild
                const members = await message.guild.members.fetch();
                
                for (const [memberId, member] of members) {
                    // Skip bots
                    if (member.user.bot) continue;
                    
                    try {
                        // Remove all game-related roles
                        await this.removeRole(member, 'Signed Up');
                        await this.removeRole(member, 'Alive');
                        await this.removeRole(member, 'Dead');
                        
                        // Assign Spectator role
                        await this.assignRole(member, 'Spectator');
                        resetMembersCount++;
                    } catch (error) {
                        console.error(`Error resetting roles for member ${member.displayName}:`, error);
                    }
                }
            } else {
                console.log('Spectator role not found - skipping member role reset');
            }
        } catch (error) {
            console.error('Error during member role reset:', error);
        }

        const successEmbed = new EmbedBuilder()
            .setTitle('✅ Server Refreshed')
            .setDescription(`Server has been successfully refreshed!\n\n• ${deletedChannelsCount} text channels deleted (kept #general)\n• ${deletedCategoriesCount} categories deleted\n• Game counter reset to 1\n• Database cleaned\n• ${resetMembersCount} members reset to Spectator role\n\nYou can now create a new game with \`Wolf.create\`.`)
            .setColor(0x00AE86);

        await message.reply({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Error during server refresh:', error);
        await message.reply('❌ An error occurred during the refresh. Some channels may need to be manually deleted.');
    }
},

};
