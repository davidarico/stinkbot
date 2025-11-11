const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'speed',
    description: 'Start speed vote with reaction target (optional custom emoji)',
    playerCommand: false,
    async execute(message, args, client, db) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Check for abort command
        if (args.length > 0 && args[0].toLowerCase() === 'abort') {
            return await handleSpeedAbort(message, game, client, db);
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
        const existingSpeedResult = await db.query(
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
            const resultsChannel = await client.channels.fetch(game.results_channel_id);
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
            await db.query(
                'INSERT INTO game_speed (game_id, message_id, channel_id, target_reactions, current_reactions, emoji) VALUES ($1, $2, $3, $4, $5, $6)',
                [game.id, speedMessage.id, resultsChannel.id, speedTarget, 0, finalEmoji]
            );

            console.log(`Speed vote created: target=${speedTarget}, emoji=${finalEmoji}, message_id=${speedMessage.id}, channel=${resultsChannel.name}`);

            // Reply to the mod who initiated the command
            await message.reply(`✅ Speed vote created in ${resultsChannel}! Target: ${speedTarget} reactions with ${finalEmoji} emoji.`);

            // Set up reaction event listener
            setupSpeedReactionListener(speedMessage, game, speedTarget, client, db);

        } catch (error) {
            console.error('Error creating speed vote:', error);
            await message.reply('❌ An error occurred while creating the speed vote.');
        }
    }
};

async function handleSpeedAbort(message, game, client, db) {
    try {
        // Check if there's an active speed vote
        const speedResult = await db.query(
            'SELECT * FROM game_speed WHERE game_id = $1',
            [game.id]
        );

        if (!speedResult.rows.length) {
            return message.reply('❌ No active speed vote to abort.');
        }

        const speedData = speedResult.rows[0];

        // Delete the speed vote from database
        await db.query(
            'DELETE FROM game_speed WHERE game_id = $1',
            [game.id]
        );

        // Try to update the original message
        try {
            const channel = await client.channels.fetch(speedData.channel_id);
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
}

function setupSpeedReactionListener(speedMessage, game, speedTarget, client, db) {
    // Set up a periodic check for reaction count updates
    const checkReactions = async () => {
        try {
            // Check if speed vote still exists in database
            const speedCheck = await db.query(
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
            const channel = await client.channels.fetch(speedMessage.channel.id);
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
                    await updateSpeedVote(speedMessage, game, speedTarget, currentReactions, customEmoji, client, db);
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
}

async function updateSpeedVote(speedMessage, game, speedTarget, currentReactions, customEmoji, client, db) {
    try {
        // Update database
        await db.query(
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
            await completeSpeedVote(game, speedMessage, client, db);
        }

    } catch (error) {
        console.error('Error updating speed vote:', error);
    }
}

async function completeSpeedVote(game, speedMessage, client, db) {
    try {
        if (game.mod_chat_channel_id === null) {
            console.error('Mod chat channel not set');
            return;
        }

        // Get mod chat channel
        const modChatChannel = await client.channels.fetch(game.mod_chat_channel_id);
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
        await db.query(
            'DELETE FROM game_speed WHERE game_id = $1',
            [game.id]
        );

        console.log(`Speed vote completed for game ${game.id}`);

    } catch (error) {
        console.error('Error completing speed vote:', error);
    }
}
