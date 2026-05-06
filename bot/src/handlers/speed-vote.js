'use strict';

const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

module.exports = {

async handleSpeedCheck(message) {
    const serverId = message.guild.id;

    // Get active game - TIMESTAMPTZ columns are automatically returned in UTC
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];

    if (!game.phase_change_at) {
        return message.reply('❌ No phase change time recorded for this game.');
    }

    try {
        // Get the town square channel
        const townSquareChannel = await this.client.channels.fetch(game.town_square_channel_id);
        if (!townSquareChannel) {
            return message.reply('❌ Town square channel not found.');
        }

        // Get all players in the game
        const playersResult = await this.db.query(
            'SELECT user_id, username FROM players WHERE game_id = $1',
            [game.id]
        );

        if (playersResult.rows.length === 0) {
            return message.reply('❌ No players found in the current game.');
        }

        // Filter players to only include those with the Alive role
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        if (!aliveRole) {
            return message.reply('❌ Alive role not found. Please use `Wolf.server_roles` to set up roles.');
        }

        // OPTIMIZATION: Fetch all guild members at once instead of individual calls
        try {
            await message.guild.members.fetch();
        } catch (error) {
            console.log('Could not fetch all guild members, falling back to individual fetches');
            // Fallback to original method if bulk fetch fails
            const alivePlayers = [];
            for (const player of playersResult.rows) {
                try {
                    const member = await message.guild.members.fetch(player.user_id);
                    if (member && member.roles.cache.has(aliveRole.id)) {
                        alivePlayers.push(player);
                    }
                } catch (error) {
                    console.error(`Error checking role for player ${player.username}:`, error);
                    // Skip this player if we can't fetch them
                }
            }
            
            if (alivePlayers.length === 0) {
                return message.reply('❌ No alive players found in the current game.');
            }

            // Randomize the player order to prevent role inference
            const shuffledPlayers = [...alivePlayers];
            for (let i = shuffledPlayers.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
            }

            // Initialize message count object
            const messageCounts = {};
            shuffledPlayers.forEach(player => {
                messageCounts[player.user_id] = {
                    username: player.username,
                    count: 0
                };
            });

            // Use phase_change_at as the start time (TIMESTAMPTZ is automatically UTC)
            const phaseChangeDate = new Date(game.phase_change_at);
            
            // Debug logging
            console.log(`Speed check debug:
                - Phase change at (raw from DB): ${game.phase_change_at}
                - Phase change as Date: ${phaseChangeDate.toISOString()}
                - Phase change in EST: ${moment.utc(game.phase_change_at).tz("America/New_York").format('YYYY-MM-DD HH:mm:ss')}
                - Current time: ${new Date().toISOString()}
                - Time difference: ${(new Date() - phaseChangeDate) / (1000 * 60)} minutes`);

            // Fetch messages from the town square since the phase change
            let allMessages = [];
            let lastMessageId = null;
            
            // Discord API limits us to 100 messages per request, so we need to paginate
            while (true) {
                const options = { limit: 100 };
                if (lastMessageId) {
                    options.before = lastMessageId;
                }

                const messages = await townSquareChannel.messages.fetch(options);
                
                if (messages.size === 0) break;

                // Filter messages by date and add to our collection
                const filteredMessages = messages.filter(msg => 
                    msg.createdAt >= phaseChangeDate && 
                    !msg.author.bot && 
                    messageCounts.hasOwnProperty(msg.author.id)
                );

                allMessages.push(...filteredMessages.values());
                
                // Check if we've gone past our date range
                const oldestMessage = messages.last();
                if (oldestMessage.createdAt < phaseChangeDate) {
                    break;
                }

                lastMessageId = oldestMessage.id;
            }

            // Count messages per player
            allMessages.forEach(msg => {
                if (messageCounts[msg.author.id]) {
                    messageCounts[msg.author.id].count++;
                }
            });

            // Sort players by message count (highest first)
            const sortedPlayers = Object.values(messageCounts)
                .sort((a, b) => b.count - a.count);

            // Convert UTC time to EST for display - TIMESTAMPTZ is already UTC
            const estTime = moment.utc(game.phase_change_at).tz("America/New_York").format('YYYY-MM-DD HH:mm:ss');
            
            // Create the response embed
            const totalMessages = allMessages.length;
            const playerList = sortedPlayers.length > 0 
                ? sortedPlayers.map((player, index) => 
                    `${index + 1}. **${player.username}**: ${player.count} messages`
                ).join('\n')
                : `No messages found from alive players since phase change.\n\n**Debug info:**\n• Phase started: ${estTime} EST\n• Current time: ${moment.utc().tz("America/New_York").format('YYYY-MM-DD HH:mm:ss')} EST\n• Messages need to be sent AFTER the phase start time`;

            const currentPhase = game.day_phase === 'day' ? '🌞 Day' : '🌙 Night';
            
            const embed = new EmbedBuilder()
                .setTitle('⚡ Speed Check - Current Phase Activity')
                .setDescription(`Message count per alive player since **${currentPhase} ${game.day_number}** started\n\n**Phase started:** ${estTime} EST`)
                .addFields(
                    { name: `Alive Player Activity (${sortedPlayers.length} players)`, value: playerList },
                    { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${townSquareChannel.name}`, inline: false }
                )
                .setColor(game.day_phase === 'day' ? 0xF1C40F : 0x2C3E50)
                .setTimestamp();

            return await message.reply({ embeds: [embed] });
        }

        // Use cached members for much faster processing
        const alivePlayers = [];
        for (const player of playersResult.rows) {
            const member = message.guild.members.cache.get(player.user_id);
            if (member && member.roles.cache.has(aliveRole.id)) {
                alivePlayers.push(player);
            }
        }

        if (alivePlayers.length === 0) {
            return message.reply('❌ No alive players found in the current game.');
        }

        // Randomize the player order to prevent role inference
        const shuffledPlayers = [...alivePlayers];
        for (let i = shuffledPlayers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
        }

        // Initialize message count object
        const messageCounts = {};
        shuffledPlayers.forEach(player => {
            messageCounts[player.user_id] = {
                username: player.username,
                count: 0
            };
        });

        // Use phase_change_at as the start time (TIMESTAMPTZ is automatically UTC)
        const phaseChangeDate = new Date(game.phase_change_at);
        
        // Debug logging
        console.log(`Speed check debug:
            - Phase change at (raw from DB): ${game.phase_change_at}
            - Phase change as Date: ${phaseChangeDate.toISOString()}
            - Phase change in EST: ${moment.utc(game.phase_change_at).tz("America/New_York").format('YYYY-MM-DD HH:mm:ss')}
            - Current time: ${new Date().toISOString()}
            - Time difference: ${(new Date() - phaseChangeDate) / (1000 * 60)} minutes`);

        // Fetch messages from the town square since the phase change
        let allMessages = [];
        let lastMessageId = null;
        
        // Discord API limits us to 100 messages per request, so we need to paginate
        while (true) {
            const options = { limit: 100 };
            if (lastMessageId) {
                options.before = lastMessageId;
            }

            const messages = await townSquareChannel.messages.fetch(options);
            
            if (messages.size === 0) break;

            // Filter messages by date and add to our collection
            const filteredMessages = messages.filter(msg => 
                msg.createdAt >= phaseChangeDate && 
                !msg.author.bot && 
                messageCounts.hasOwnProperty(msg.author.id)
            );

            allMessages.push(...filteredMessages.values());
            
            // Check if we've gone past our date range
            const oldestMessage = messages.last();
            if (oldestMessage.createdAt < phaseChangeDate) {
                break;
            }

            lastMessageId = oldestMessage.id;
        }

        // Count messages per player
        allMessages.forEach(msg => {
            if (messageCounts[msg.author.id]) {
                messageCounts[msg.author.id].count++;
            }
        });

        // Sort players by message count (highest first)
        const sortedPlayers = Object.values(messageCounts)
            .sort((a, b) => b.count - a.count);

        // Convert UTC time to EST for display - TIMESTAMPTZ is already UTC
        const estTime = moment.utc(game.phase_change_at).tz("America/New_York").format('YYYY-MM-DD HH:mm:ss');
        
        // Create the response embed
        const totalMessages = allMessages.length;
        const playerList = sortedPlayers.length > 0 
            ? sortedPlayers.map((player, index) => 
                `${index + 1}. **${player.username}**: ${player.count} messages`
            ).join('\n')
            : `No messages found from alive players since phase change.\n\n**Debug info:**\n• Phase started: ${estTime} EST\n• Current time: ${moment.utc().tz("America/New_York").format('YYYY-MM-DD HH:mm:ss')} EST\n• Messages need to be sent AFTER the phase start time`;

        const currentPhase = game.day_phase === 'day' ? '🌞 Day' : '🌙 Night';
        
        const embed = new EmbedBuilder()
            .setTitle('⚡ Speed Check - Current Phase Activity')
            .setDescription(`Message count per alive player since **${currentPhase} ${game.day_number}** started\n\n**Phase started:** ${estTime} EST`)
            .addFields(
                { name: `Alive Player Activity (${sortedPlayers.length} players)`, value: playerList },
                { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${townSquareChannel.name}`, inline: false }
            )
            .setColor(game.day_phase === 'day' ? 0xF1C40F : 0x2C3E50)
            .setTimestamp();

        return await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error fetching speed check activity:', error);
        await message.reply('❌ An error occurred while fetching speed check activity.');
    }
},

async handleSpeed(message, args) {
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

    // Check for abort command
    if (args.length > 0 && args[0].toLowerCase() === 'abort') {
        return await this.handleSpeedAbort(message, game);
    }

    // Check if speed target is provided
    if (!args.length || isNaN(parseInt(args[0]))) {
        return message.reply('❌ Please provide a valid speed target number. Usage: `Wolf.speed <number> [emoji]` or `Wolf.speed abort`');
    }

    const speedTarget = parseInt(args[0]);

    if (speedTarget < 1) {
        return message.reply('❌ Speed target must be at least 1.');
    }

    // Parse emoji from args (optional second parameter)
    let customEmoji = '⚡'; // Default to lightning bolt
    if (args.length > 1) {
        const emojiArg = args[1];
        // Check if it's a valid emoji (starts with : and ends with :)
        if (emojiArg.startsWith(':') && emojiArg.endsWith(':')) {
            customEmoji = emojiArg;
        } else {
            // If it's not in the :emoji: format, treat it as a raw emoji
            customEmoji = emojiArg;
        }
    }

    // Check if there's already an active speed vote
    const existingSpeedResult = await this.db.query(
        'SELECT * FROM game_speed WHERE game_id = $1',
        [game.id]
    );

    if (existingSpeedResult.rows.length > 0) {
        return message.reply('❌ There is already an active speed vote. Use `Wolf.speed abort` to cancel it first.');
    }

    try {
        // Get the alive role
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        if (!aliveRole) {
            return message.reply('❌ Alive role not found. Please use `Wolf.server_roles` to set up roles.');
        }

        // Get the results channel
        const resultsChannel = await this.client.channels.fetch(game.results_channel_id);
        if (!resultsChannel) {
            return message.reply('❌ Results channel not found.');
        }

        // Create the speed vote embed
        const embed = new EmbedBuilder()
            .setTitle('⚡ Speed Vote!')
            .setDescription(`Bunch of impatient players want to speed up the game! React with ${customEmoji} if you agree!`)
            .addFields(
                { name: 'Target', value: speedTarget.toString(), inline: true },
                { name: 'Status', value: 'Waiting for reactions...', inline: true }
            )
            .setColor(0xFFD700)
            .setTimestamp();

        // Send the message and ping alive players in the results channel
        const speedMessage = await resultsChannel.send({
            content: `${aliveRole}`,
            embeds: [embed]
        });

        // Try to add the custom emoji reaction, fallback to default if it fails
        let finalEmoji = customEmoji;
        try {
            await speedMessage.react(customEmoji);
        } catch (error) {
            if (error.code === 10014) { // Unknown Emoji error
                console.log(`Unknown emoji "${customEmoji}" provided, falling back to default ⚡`);
                finalEmoji = '⚡';
                await speedMessage.react(finalEmoji);
                
                // Update the embed description to use the default emoji
                const updatedEmbed = new EmbedBuilder()
                    .setTitle('⚡ Speed Vote!')
                    .setDescription(`Bunch of impatient players want to speed up the game! React with ${finalEmoji} if you agree!`)
                    .addFields(
                        { name: 'Target', value: speedTarget.toString(), inline: true },
                        { name: 'Status', value: 'Waiting for reactions...', inline: true }
                    )
                    .setColor(0xFFD700)
                    .setTimestamp();
                
                await speedMessage.edit({ embeds: [updatedEmbed] });
                
                // Notify the user about the fallback
                await message.reply(`⚠️ Unknown emoji "${customEmoji}" provided. Using default emoji ⚡ instead.`);
            } else {
                // Re-throw other errors
                throw error;
            }
        }

        // Store the speed vote in the database with the final emoji
        await this.db.query(
            'INSERT INTO game_speed (game_id, message_id, channel_id, target_reactions, current_reactions, emoji) VALUES ($1, $2, $3, $4, $5, $6)',
            [game.id, speedMessage.id, resultsChannel.id, speedTarget, 0, finalEmoji]
        );

        console.log(`Speed vote created: target=${speedTarget}, emoji=${finalEmoji}, message_id=${speedMessage.id}, channel=${resultsChannel.name}`);

        // Reply to the mod who initiated the command
        await message.reply(`✅ Speed vote created in ${resultsChannel}! Target: ${speedTarget} reactions with ${finalEmoji} emoji.`);

        // Set up reaction event listener
        this.setupSpeedReactionListener(speedMessage, game, speedTarget);

    } catch (error) {
        console.error('Error creating speed vote:', error);
        await message.reply('❌ An error occurred while creating the speed vote.');
    }
},

async handleSpeedAbort(message, game) {
    try {
        // Check if there's an active speed vote
        const speedResult = await this.db.query(
            'SELECT * FROM game_speed WHERE game_id = $1',
            [game.id]
        );

        if (!speedResult.rows.length) {
            return message.reply('❌ No active speed vote to abort.');
        }

        const speedData = speedResult.rows[0];

        // Delete the speed vote from database
        await this.db.query(
            'DELETE FROM game_speed WHERE game_id = $1',
            [game.id]
        );

        // Try to update the original message
        try {
            const channel = await this.client.channels.fetch(speedData.channel_id);
            const speedMessage = await channel.messages.fetch(speedData.message_id);

            const abortEmbed = new EmbedBuilder()
                .setTitle('⚡ Speed Vote Aborted')
                .setDescription('The speed vote has been cancelled by a moderator.')
                .setColor(0xFF0000)
                .setTimestamp();

            await speedMessage.edit({ embeds: [abortEmbed] });
        } catch (error) {
            console.error('Error updating speed message after abort:', error);
        }

        await message.reply('✅ Speed vote has been aborted.');

    } catch (error) {
        console.error('Error aborting speed vote:', error);
        await message.reply('❌ An error occurred while aborting the speed vote.');
    }
},

setupSpeedReactionListener(speedMessage, game, speedTarget) {
    // Set up a periodic check for reaction count updates
    const checkReactions = async () => {
        try {
            // Check if speed vote still exists in database
            const speedCheck = await this.db.query(
                'SELECT * FROM game_speed WHERE game_id = $1',
                [game.id]
            );

            if (!speedCheck.rows.length) {
                // Speed vote was aborted or completed
                clearInterval(intervalId);
                return;
            }

            const speedData = speedCheck.rows[0];
            const customEmoji = speedData.emoji || '⚡'; // Use stored emoji or default to lightning bolt

            // Fetch the latest message to get current reactions
            const channel = await this.client.channels.fetch(speedMessage.channel.id);
            const message = await channel.messages.fetch(speedMessage.id);
            
            // Find the custom emoji reaction
            let emojiReaction;
            if (customEmoji.startsWith('<:') && customEmoji.endsWith('>')) {
                // Custom emoji format: <:name:id>
                const emojiId = customEmoji.match(/:(\d+)>/)?.[1];
                if (emojiId) {
                    emojiReaction = message.reactions.cache.get(emojiId);
                }
            } else {
                // Unicode emoji
                emojiReaction = message.reactions.cache.get(customEmoji);
            }
            
            if (emojiReaction) {
                // Count non-bot reactions
                const users = await emojiReaction.users.fetch();
                const currentReactions = users.filter(user => !user.bot).size;
                
                // Get the stored reaction count from database
                const storedCount = speedData.current_reactions;
                
                // Only update if the count has changed
                if (currentReactions !== storedCount) {
                    console.log(`Speed vote reaction count changed: ${storedCount} -> ${currentReactions}`);
                    await this.updateSpeedVote(speedMessage, game, speedTarget, currentReactions, customEmoji);
                }
            }
        } catch (error) {
            console.error('Error checking speed vote reactions:', error);
            clearInterval(intervalId);
        }
    };

    // Check every 2 seconds for reaction updates
    const intervalId = setInterval(checkReactions, 2000);
    
    // Initial check after a short delay to ensure the reaction is added
    setTimeout(checkReactions, 1000);
},

async updateSpeedVote(speedMessage, game, speedTarget, currentReactions, customEmoji = '⚡') {
    try {
        // Update database
        await this.db.query(
            'UPDATE game_speed SET current_reactions = $1 WHERE game_id = $2',
            [currentReactions, game.id]
        );

        // Update the embed
        const embed = new EmbedBuilder()
            .setTitle('⚡ Speed Vote!')
            .setDescription(`Bunch of impatient players want to speed up the game! React with ${customEmoji} if you agree!`)
            .addFields(
                { name: 'Target', value: speedTarget.toString(), inline: true },
                { name: 'Status', value: currentReactions >= speedTarget ? 'Target reached!' : 'Waiting for reactions...', inline: true }
            )
            .setColor(currentReactions >= speedTarget ? 0x00FF00 : 0xFFD700)
            .setTimestamp();

        await speedMessage.edit({ embeds: [embed] });

        // Check if target is reached
        if (currentReactions >= speedTarget) {
            await this.completeSpeedVote(game, speedMessage);
        }

    } catch (error) {
        console.error('Error updating speed vote:', error);
    }
},

async completeSpeedVote(game, speedMessage) {
    try {
        if (game.mod_chat_channel_id === null) {
            console.error('Mod chat channel not set');
            return;
        }

        // Get mod chat channel
        const modChatChannel = await this.client.channels.fetch(game.mod_chat_channel_id);
        if (!modChatChannel) {
            console.error('Mod chat channel not found');
            return;
        }

        // Get mod role
        const modRole = speedMessage.guild.roles.cache.find(r => r.name === 'Mod');

        // Send notification to mod chat
        const notificationEmbed = new EmbedBuilder()
            .setTitle('⚡ Speed Vote Completed!')
            .setDescription('The speed vote target has been reached. Players want to speed up the game!')
            .addFields(
                { name: 'Channel', value: `<#${speedMessage.channel.id}>`, inline: true },
                { name: 'Action Required', value: 'AMAB, what is taking you so long?', inline: true }
            )
            .setColor(0x00FF00)
            .setTimestamp();

        if (modRole) {
            await modChatChannel.send({
                content: `${modRole}`,
                embeds: [notificationEmbed]
            });
        } else {
            await modChatChannel.send({ embeds: [notificationEmbed] });
        }

        // Update the original speed message
        const completedEmbed = new EmbedBuilder()
            .setTitle('⚡ Speed Vote Completed!')
            .setDescription('Target reached! Moderators have been notified.\nPing them 47 more times to make sure they see this!')
            .setColor(0x00FF00)
            .setTimestamp();

        await speedMessage.edit({ embeds: [completedEmbed] });

        // Delete the speed vote from database
        await this.db.query(
            'DELETE FROM game_speed WHERE game_id = $1',
            [game.id]
        );

        console.log(`Speed vote completed for game ${game.id}`);

    } catch (error) {
        console.error('Error completing speed vote:', error);
    }
},

async handleReaction(reaction, user) {
    try {
        const fullReaction = reaction.partial ? await reaction.fetch() : reaction;
        const msg = fullReaction.message;
        const guild = msg?.guild;
        if (guild && msg && !user.bot) {
            const emojiName = fullReaction.emoji?.name;
            const isPinEmoji = emojiName === 'pushpin' || fullReaction.emoji?.toString() === '📌';
            if (isPinEmoji) {
                const member = await guild.members.fetch(user.id).catch(() => null);
                if (member && this.hasModeratorPermissions(member)) {
                    try {
                        await msg.pin(`Pinned by ${member.displayName} via 📌 reaction`);
                    } catch (pinErr) {
                        console.warn('[handleReaction] Mod pin via reaction failed:', pinErr?.message || pinErr);
                    }
                }
            }
        }

        // Check if this is a speed vote message
        const reactionMessageId = msg?.id || reaction.message?.id;
        const speedVote = await this.db.query(
            'SELECT * FROM game_speed WHERE message_id = $1',
            [reactionMessageId]
        );

        if (speedVote.rows.length === 0) return;

        const speedData = speedVote.rows[0];
        const customEmoji = speedData.emoji || '⚡'; // Use stored emoji or default to lightning bolt

        // Only handle reactions with the custom emoji for this speed vote
        let isCorrectEmoji = false;
        if (customEmoji.startsWith('<:') && customEmoji.endsWith('>')) {
            // Custom emoji format: <:name:id>
            const emojiId = customEmoji.match(/:(\d+)>/)?.[1];
            if (emojiId && fullReaction.emoji.id === emojiId) {
                isCorrectEmoji = true;
            }
        } else {
            // Unicode emoji
            if (fullReaction.emoji.name === customEmoji || fullReaction.emoji.toString() === customEmoji) {
                isCorrectEmoji = true;
            }
        }
        
        if (!isCorrectEmoji) return;

        // Check if the user has the "Alive" role
        const speedGuild = msg?.guild || reaction.message.guild;
        const member = await speedGuild.members.fetch(user.id).catch(() => null);
        
        if (!member) {
            console.log(`Could not fetch member ${user.tag} for reaction check`);
            return;
        }

        const aliveRole = speedGuild.roles.cache.find(r => r.name === 'Alive');
        if (!aliveRole) {
            console.log('Alive role not found in guild, allowing reaction');
            return;
        }

        // If user doesn't have the Alive role, remove their reaction
        if (!member.roles.cache.has(aliveRole.id)) {
            await reaction.users.remove(user.id);
            console.log(`Removed reaction from ${user.displayName} (${user.id}) - user does not have Alive role`);
            
            // Post message in mod-chat about the invalid reaction
            try {
                const gameResult = await this.db.query(
                    'SELECT mod_chat_channel_id FROM games WHERE server_id = $1 AND status = $2',
                    [speedGuild.id, 'active']
                );
                
                if (gameResult.rows.length > 0 && gameResult.rows[0].mod_chat_channel_id) {
                    const modChatChannel = await this.client.channels.fetch(gameResult.rows[0].mod_chat_channel_id);
                    if (modChatChannel) {
                        await modChatChannel.send(`❌ ${user.displayName} tried to react to the speed vote but doesn't have the "Alive" role. Their reaction has been removed.`);
                    }
                }
            } catch (modChatError) {
                console.log(`Could not send message to mod-chat:`, modChatError.message);
            }
            return;
        }

        // Remove the bot's initial reaction to keep the count clean
        // The bot's reaction doesn't count toward the target but helps users react
        // Only remove bot reaction if the user is valid (has Alive role)
        await reaction.users.remove(this.client.user.id);
        
        console.log(`Removed bot reaction from speed vote message ${reaction.message.id} after ${user.tag} reacted with ${customEmoji}`);

    } catch (error) {
        console.error('Error handling reaction:', error);
    }
},

};
