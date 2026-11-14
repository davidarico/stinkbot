'use strict';

const { ChannelType, EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

const WINNING_TEAM_LABELS = { town: 'Town', wolf: 'Wolves', neutral: 'Neutral', draw: 'Draw' };

// Maps what a mod types to a games.winning_team value, or null if it isn't a team.
function parseWinningTeam(input) {
    switch (String(input || '').trim().toLowerCase()) {
        case 'town':
        case 'village':
        case 'villagers':
            return 'town';
        case 'wolf':
        case 'wolves':
            return 'wolf';
        case 'neutral':
        case 'neutrals':
            return 'neutral';
        case 'draw':
        case 'tie':
            return 'draw';
        default:
            return null;
    }
}

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

    // Snapshot of the phase being left, so Wolf.rollback can undo this exact phase change
    // (feedback #63). Only the most recent Wolf.next can be rolled back.
    const rollbackSnapshot = {
        day_phase: game.day_phase,
        day_number: game.day_number,
        phase_change_at: game.phase_change_at,
        voting_message_id: game.voting_message_id || null,
        last_phase_pin_message_id: game.last_phase_pin_message_id || null
    };

    // Update game phase with explicit UTC timestamp
    await this.db.query(
        'UPDATE games SET day_phase = $1, day_number = $2, phase_change_at = $3, last_next_snapshot = $5 WHERE id = $4',
        [newPhase, newDay, new Date().toISOString(), game.id, JSON.stringify(rollbackSnapshot)]
    );
    this.invalidateActivityGameCache(serverId);

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
                const sentMessage = await channel.send({ embeds: [embed] });

                // Auto-pin the phase-start message in town square, unpinning the previous one
                // (feedback #81, #89 - requested twice)
                if (channelId === game.town_square_channel_id) {
                    if (game.last_phase_pin_message_id) {
                        try {
                            const previousPin = await channel.messages.fetch(game.last_phase_pin_message_id);
                            await previousPin.unpin();
                        } catch (error) {
                            console.error(`Error unpinning previous phase message ${game.last_phase_pin_message_id}:`, error);
                        }
                    }

                    try {
                        await sentMessage.pin();
                        await this.db.query(
                            'UPDATE games SET last_phase_pin_message_id = $1 WHERE id = $2',
                            [sentMessage.id, game.id]
                        );
                    } catch (error) {
                        console.error(`Error pinning phase message ${sentMessage.id}:`, error);
                    }
                }
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


    // If it's a new day, create new voting message
    const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
    // Only create a new voting message for day 2+ (day 1 doesn't have voting)
    if (newPhase === 'day' && newDay >= 2) {
        console.log(`[DEBUG] Creating voting message for Day ${newDay} in game ${game.id}`);
        await this.createVotingMessage(game.id, votingChannel);
    }

    await this.applyPhasePermissions(message.guild, game, newPhase, newDay, votingChannel);

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

// Undo the most recent Wolf.next (feedback #63). Wolf.next stores a snapshot of the phase
// it left in games.last_next_snapshot; this restores it, puts that day's standing votes
// back, fixes pins and channel permissions, and tells town square.
async handleRollback(message) {
    const serverId = message.guild.id;

    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];
    const snapshot = game.last_next_snapshot;

    if (!snapshot || !snapshot.day_phase) {
        return message.reply('❌ Nothing to roll back. Only the most recent `Wolf.next` can be undone, and only once.');
    }

    const currentLabel = `${game.day_phase} ${game.day_number}`;
    const restoredLabel = `${snapshot.day_phase} ${snapshot.day_number}`;
    // Rolling back a day start throws away the votes cast since; rolling back a nightfall
    // brings the wiped votes back.
    const undoingDayStart = game.day_phase === 'day';

    const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Rollback')
        .setDescription(
            [
                `This will undo the last \`Wolf.next\` and take the game from **${currentLabel}** back to **${restoredLabel}**.`,
                '',
                '**It will:**',
                undoingDayStart
                    ? `- Delete the Day ${game.day_number} voting message and any votes already cast on it`
                    : `- Restore the Day ${snapshot.day_number} votes and reopen the voting booth`,
                '- Reset channel permissions and the pinned phase message',
                '- Announce the rollback in town square',
                '',
                '**It will NOT:**',
                '- Delete the phase messages already posted, or undo kills and role changes',
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
        return message.reply('❌ Rollback cancelled.');
    }

    const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
    let restoredVotes = 0;

    if (undoingDayStart) {
        // The voting message Wolf.next just created belongs to a day that hasn't started
        if (game.voting_message_id && game.voting_message_id !== snapshot.voting_message_id) {
            try {
                const staleVotingMessage = await votingChannel.messages.fetch(game.voting_message_id);
                await staleVotingMessage.delete();
            } catch (error) {
                console.error(`Error deleting voting message ${game.voting_message_id} during rollback:`, error);
            }
        }

        await this.db.query('DELETE FROM votes WHERE game_id = $1', [game.id]);
        // Drop the undone day from vote_history too, otherwise those votes would count as
        // standing when the day is played for real.
        await this.db.query(
            'DELETE FROM vote_history WHERE game_id = $1 AND day_number = $2',
            [game.id, game.day_number]
        );
    } else {
        // Rebuild the standing votes Wolf.next wiped: each voter's last action that day
        // stands, unless it was a retract (same reconstruction as Wolf.lssv for past days).
        await this.db.query('DELETE FROM votes WHERE game_id = $1', [game.id]);
        const restoreResult = await this.db.query(
            `INSERT INTO votes (game_id, voter_user_id, target_user_id, day_number, voted_at)
             SELECT game_id, voter_user_id, target_user_id, day_number, created_at
             FROM (
                 SELECT DISTINCT ON (voter_user_id) game_id, voter_user_id, target_user_id, day_number, action, created_at
                 FROM vote_history
                 WHERE game_id = $1 AND day_number = $2
                 ORDER BY voter_user_id, created_at DESC, id DESC
             ) last_action
             WHERE action = 'vote'`,
            [game.id, snapshot.day_number]
        );
        restoredVotes = restoreResult.rowCount || 0;
    }

    await this.db.query(
        `UPDATE games SET day_phase = $1, day_number = $2, phase_change_at = $3, voting_message_id = $4,
                last_phase_pin_message_id = $5, last_next_snapshot = NULL
         WHERE id = $6`,
        [snapshot.day_phase, snapshot.day_number, snapshot.phase_change_at || new Date().toISOString(),
            snapshot.voting_message_id, snapshot.last_phase_pin_message_id, game.id]
    );
    this.invalidateActivityGameCache(serverId);

    // Messages sent during the undone phase belong to the restored one. Fold their
    // counts back so Wolf.speed_check and Wolf.silent don't lose them.
    try {
        await this.db.query(
            `INSERT INTO message_activity (game_id, channel_id, user_id, day_number, day_phase, bucket_start, message_count)
             SELECT game_id, channel_id, user_id, $4, $5, bucket_start, message_count
             FROM message_activity
             WHERE game_id = $1 AND day_number = $2 AND day_phase = $3
             ON CONFLICT (game_id, channel_id, user_id, day_number, day_phase, bucket_start)
             DO UPDATE SET message_count = message_activity.message_count + EXCLUDED.message_count`,
            [game.id, game.day_number, game.day_phase, snapshot.day_number, snapshot.day_phase]
        );
        await this.db.query(
            'DELETE FROM message_activity WHERE game_id = $1 AND day_number = $2 AND day_phase = $3',
            [game.id, game.day_number, game.day_phase]
        );
    } catch (error) {
        console.error('Error moving message activity back to the restored phase:', error);
    }

    const restoredGame = {
        ...game,
        day_phase: snapshot.day_phase,
        day_number: snapshot.day_number,
        voting_message_id: snapshot.voting_message_id
    };

    await this.applyPhasePermissions(message.guild, restoredGame, snapshot.day_phase, snapshot.day_number, votingChannel);

    // Show the restored votes on the day's voting message again
    if (snapshot.day_phase === 'day' && snapshot.day_number >= 2) {
        await this.updateVotingMessage(restoredGame);
    }

    const title = '⏪ Phase Rolled Back';
    const color = snapshot.day_phase === 'day' ? 0xF1C40F : 0x2C3E50;

    if (game.town_square_channel_id) {
        try {
            const townSquare = await this.client.channels.fetch(game.town_square_channel_id);

            // Swap the pinned phase message back to the restored phase's
            if (game.last_phase_pin_message_id) {
                try {
                    const currentPin = await townSquare.messages.fetch(game.last_phase_pin_message_id);
                    await currentPin.unpin();
                } catch (error) {
                    console.error(`Error unpinning phase message ${game.last_phase_pin_message_id} during rollback:`, error);
                }
            }
            if (snapshot.last_phase_pin_message_id) {
                try {
                    const previousPin = await townSquare.messages.fetch(snapshot.last_phase_pin_message_id);
                    await previousPin.pin();
                } catch (error) {
                    console.error(`Error re-pinning phase message ${snapshot.last_phase_pin_message_id} during rollback:`, error);
                }
            }

            const announceEmbed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(`The last phase change was undone. It is **${restoredLabel}** again.`)
                .setColor(color);
            await townSquare.send({ embeds: [announceEmbed] });
        } catch (error) {
            console.error('Error announcing rollback in town square:', error);
        }
    }

    let summary = `Rolled back from **${currentLabel}** to **${restoredLabel}**.`;
    if (!undoingDayStart && snapshot.day_number >= 2) {
        summary += `\n\n🗳️ Restored **${restoredVotes}** standing vote${restoredVotes === 1 ? '' : 's'} for Day ${snapshot.day_number}.`;
    }

    const replyEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(summary)
        .setColor(color);

    await message.reply({ embeds: [replyEmbed] });
},

// Open or close the voting booth and the extra game channels for a phase. Shared by
// Wolf.next and Wolf.rollback so both leave channels in the same state.
async applyPhasePermissions(guild, game, phase, dayNumber, votingChannel) {
    const aliveRole = guild.roles.cache.find(r => r.name === 'Alive');

    // Voting is only open during the day, and only from day 2 (day 1 doesn't have voting)
    await votingChannel.permissionOverwrites.edit(aliveRole.id, {
        SendMessages: phase === 'day' && dayNumber >= 2
    });

    // Handle game channel permissions based on open_at_dawn and open_at_dusk flags
    try {
        // Get all game channels for this game
        const gameChannelsResult = await this.db.query(
            'SELECT channel_id, open_at_dawn, open_at_dusk, is_couple_chat FROM game_channels WHERE game_id = $1',
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

                if (channelData.is_couple_chat) {
                    // Couple chat is a night-only channel (feedback #82): always closed during
                    // the day and open at night, regardless of the open_at_dawn/open_at_dusk
                    // flags (which default to TRUE in the schema and aren't reliably set for
                    // manually-created couple chats). Members keep ViewChannel either way.
                    shouldAllowSendMessages = phase === 'night';
                    shouldAllowAddReactions = phase === 'night';
                } else if (phase === 'day') {
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

                console.log(`[DEBUG] Updated channel ${channel.name} permissions: Alive role can send messages = ${shouldAllowSendMessages} (${phase} phase)`);
            } catch (error) {
                console.error(`Error updating permissions for channel ${channelData.channel_id}:`, error);
            }
        }
    } catch (error) {
        console.error('Error handling game channel permissions:', error);
    }
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

    // Record who won so stats features have something to read. A game that never
    // left signups has no winner, and not answering just leaves it unset.
    let winningTeam = null;
    if (game.status === 'active') {
        await message.reply('🏆 Who won? Type `town`, `wolves`, `neutral` or `draw` (or `skip` to leave it unset).');
        const winnerFilter = (m) => m.author.id === message.author.id &&
            (m.content.trim().toLowerCase() === 'skip' || parseWinningTeam(m.content) !== null);
        const winnerCollected = await message.channel.awaitMessages({ filter: winnerFilter, max: 1, time: 60000 });
        if (winnerCollected.size) {
            winningTeam = parseWinningTeam(winnerCollected.first().content);
        }
    }

    // Update game status
    await this.db.query(
        'UPDATE games SET status = $1, winning_team = $2 WHERE id = $3',
        ['ended', winningTeam, game.id]
    );
    this.invalidateActivityGameCache(serverId);

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

    // The game is over, so nobody's journal is "active" any more (feedback #88)
    const archivedJournals = await this.archiveAllActiveJournals(message.guild);

    let endDescription = 'The game has been officially ended.';
    if (archivedJournals > 0) {
        endDescription += `\n\n📔 Moved ${archivedJournals} journal${archivedJournals === 1 ? '' : 's'} back to the journal archive.`;
    }
    if (winningTeam) {
        endDescription += `\n\n🏆 **Winner:** ${WINNING_TEAM_LABELS[winningTeam]}`;
    } else if (game.status === 'active') {
        endDescription += '\n\nNo winner recorded. Set it later with `Wolf.winner <town|wolves|neutral|draw>`.';
    }

    const successEmbed = new EmbedBuilder()
        .setTitle('🏁 Game Ended')
        .setDescription(endDescription)
        .setColor(0x95A5A6);

    await message.reply({ embeds: [successEmbed] });
},

// Set or correct the winner of the most recently ended game.
async handleWinner(message, args) {
    const winningTeam = parseWinningTeam(args.join(' '));
    if (!winningTeam) {
        return message.reply('❌ Usage: `Wolf.winner <town|wolves|neutral|draw>`');
    }

    const gameResult = await this.db.query(
        'SELECT id, game_number, game_name FROM games WHERE server_id = $1 AND status = $2 ORDER BY id DESC LIMIT 1',
        [message.guild.id, 'ended']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No ended game found.');
    }

    const game = gameResult.rows[0];
    await this.db.query('UPDATE games SET winning_team = $1 WHERE id = $2', [winningTeam, game.id]);

    const gameLabel = game.game_name ? `${game.game_name} Game ${game.game_number}` : `Game ${game.game_number}`;
    await message.reply(`🏆 Recorded **${WINNING_TEAM_LABELS[winningTeam]}** as the winner of ${gameLabel}.`);
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
                '- For every member with the **Alive** or **Dead** role: remove it and add **Signed Up**',
                '',
                '**It will NOT do:**',
                '- Delete/recreate channels, rename channels, or undo any channel permission changes',
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
    this.invalidateActivityGameCache(serverId);

    const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
    const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');
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

    // Dead players are back in the game too once it rewinds to signups (feedback #57)
    const gameMembers = message.guild.members.cache.filter(
        m => !m.user.bot && (m.roles.cache.has(aliveRole.id) || (deadRole && m.roles.cache.has(deadRole.id)))
    );

    for (const [, member] of gameMembers) {
        processed++;
        try {
            if (member.roles.cache.has(aliveRole.id)) {
                await member.roles.remove(aliveRole);
            }
            if (deadRole && member.roles.cache.has(deadRole.id)) {
                await member.roles.remove(deadRole);
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
        `✅ Scuffed game #${game.game_number}: set status back to \`signup\` and updated roles for **${updated}/${processed}** Alive and Dead members` +
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
