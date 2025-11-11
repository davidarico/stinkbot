const { ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'create',
    playerCommand: false,  // admin only
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        // Get server config
        const configResult = await bot.db.query(
            'SELECT * FROM server_configs WHERE server_id = $1',
            [serverId]
        );

        if (!configResult.rows.length) {
            return message.reply('❌ Please run `Wolf.setup` first to configure the server.');
        }

        const config = configResult.rows[0];

        // Check if there's an active game
        const activeGameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3)',
            [serverId, 'signup', 'active']
        );

        if (activeGameResult.rows.length > 0) {
            return message.reply('❌ There is already an active game. Please finish the current game first.');
        }

        // Create category and signup channel
        const categoryName = config.game_name
            ? `${config.game_name} Game ${config.game_counter}`
            : `Game ${config.game_counter}`;

        const category = await message.guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
        });

        // Position the category at the top of existing game categories
        try {
            // Find all existing game categories (that match our naming pattern)
            const existingGameCategories = message.guild.channels.cache
                .filter(channel =>
                    channel.type === ChannelType.GuildCategory &&
                    channel.id !== category.id && // Exclude the newly created category
                    (
                        (config.game_name && channel.name.includes(`${config.game_name} Game`)) ||
                        (!config.game_name && channel.name.match(/^Game \d+$/))
                    )
                )
                .sort((a, b) => a.position - b.position); // Sort by current position

            if (existingGameCategories.size > 0) {
                // Get the position of the first (topmost) existing game category
                const topGameCategory = existingGameCategories.first();
                const targetPosition = topGameCategory.position;

                // Move our new category to that position (this will push others down)
                await category.setPosition(targetPosition);
                console.log(`Positioned new category "${categoryName}" at position ${targetPosition}`);
            }
        } catch (error) {
            console.error('Error positioning category:', error);
            // Continue even if positioning fails - category is still created
        }

        // Create mod chat channel
        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');

        const modChatName = `${config.game_prefix}${config.game_counter}-mod-chat`;
        const modChat = await message.guild.channels.create({
            name: modChatName,
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
                }
            ]
        });

        // Create breakdown channel
        const breakdownName = `${config.game_prefix}${config.game_counter}-breakdown`;
        await message.guild.channels.create({
            name: breakdownName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: modRole.id,
                    allow: ['ViewChannel', 'SendMessages']
                }
            ]
        });

        const signupChannelName = `${config.game_prefix}${config.game_counter}-signups`;
        const signupChannel = await message.guild.channels.create({
            name: signupChannelName,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        // Save game to database first and get the game ID
        const gameResult = await bot.db.query(
            `INSERT INTO games (server_id, game_number, game_name, signup_channel_id, category_id, mod_chat_channel_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [serverId, config.game_counter, config.game_name, signupChannel.id, category.id, modChat.id]
        );

        const gameId = gameResult.rows[0].id;

        // Update server config counter
        await bot.db.query(
            'UPDATE server_configs SET game_counter = game_counter + 1 WHERE server_id = $1',
            [serverId]
        );

        // Build website management URL if WEBSITE_URL is configured
        const websiteUrl = process.env.WEBSITE_URL;
        let managementUrl = 'Not configured (WEBSITE_URL env variable missing)';
        if (websiteUrl) {
            managementUrl = `${websiteUrl}/game/${gameId}?p=${category.id}`;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎮 New Game Created!')
            .setDescription(`Game ${config.game_counter} has been created.`)
            .addFields(
                { name: 'Category', value: categoryName, inline: true },
                { name: 'Signup Channel', value: `<#${signupChannel.id}>`, inline: true },
                { name: '🌐 Management URL', value: `${managementUrl}`, inline: false },
                { name: '🔑 Password', value: `\`${category.id}\``, inline: true },
                { name: '🆔 Game ID', value: `\`${gameId}\``, inline: true }
            )
            .setColor(0x00AE86);

        await message.reply({ embeds: [embed] });

        // Post management information in mod chat and pin it
        const modManagementEmbed = new EmbedBuilder()
            .setTitle('🌐 Game Management Information')
            .setDescription('Use this information to manage the game through the website.')
            .addFields(
                { name: '🌐 Management URL', value: managementUrl, inline: false },
                { name: '🔑 Password', value: `\`${category.id}\``, inline: true },
                { name: '🆔 Game ID', value: `\`${gameId}\``, inline: true },
                { name: '📊 Game Number', value: `\`${config.game_counter}\``, inline: true }
            )
            .setColor(0x00AE86);

        const modManagementMessage = await modChat.send({ embeds: [modManagementEmbed] });

        // Pin the management message
        try {
            await modManagementMessage.pin();
            console.log(`[DEBUG] Pinned mod management message ${modManagementMessage.id}`);
        } catch (error) {
            console.error('Error pinning mod management message:', error);
            // Continue even if pinning fails
        }

        const signupEmbed = new EmbedBuilder()
            .setTitle('🐺 Werewolf Game Signups')
            .setDescription('A new game is starting! Use `Wolf.in` to join or `Wolf.out` to leave.')
            .setColor(0x3498DB);

        const signupMessage = await signupChannel.send({ embeds: [signupEmbed] });

        // Pin the signup message and store its ID in the database
        try {
            await signupMessage.pin();
            console.log(`[DEBUG] Pinned signup message ${signupMessage.id}`);
        } catch (error) {
            console.error('Error pinning signup message:', error);
            // Continue even if pinning fails
        }

        // Store the signup message ID in the database
        await bot.db.query(
            'UPDATE games SET signup_message_id = $1 WHERE id = $2',
            [signupMessage.id, gameId]
        );

        // Move all journal categories to be positioned after the new game category for better organization
        try {
            const journalCategories = message.guild.channels.cache.filter(
                channel => channel.type === ChannelType.GuildCategory &&
                (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
            );

            if (journalCategories.size > 0) {
                console.log(`Moving ${journalCategories.size} journal categories after new game category`);

                // Sort journal categories alphabetically
                const sortedJournalCategories = Array.from(journalCategories.values()).sort((a, b) => {
                    return a.name.localeCompare(b.name);
                });

                // Move each journal category to be positioned after the game category in alphabetical order
                let position = category.position + 1;
                for (const journalCategory of sortedJournalCategories) {
                    // Move the journal category
                    await journalCategory.setPosition(position);
                    console.log(`Moved journal category "${journalCategory.name}" to position ${position}`);

                    // Poll for position confirmation with 10 second timeout
                    let confirmed = false;
                    let attempts = 0;
                    const maxAttempts = 10; // 10 seconds total

                    while (!confirmed && attempts < maxAttempts) {
                        // Wait 1 second before checking
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        // Refresh the Discord cache
                        await message.guild.channels.fetch();

                        // Check if the position has been updated
                        const refreshedCategory = message.guild.channels.cache.get(journalCategory.id);
                        if (refreshedCategory && refreshedCategory.position === position) {
                            console.log(`✅ Confirmed "${journalCategory.name}" is now at position ${position} (attempt ${attempts + 1})`);
                            confirmed = true;
                        } else {
                            attempts++;
                            console.log(`⏳ Waiting for "${journalCategory.name}" to reach position ${position}... (attempt ${attempts}/${maxAttempts})`);
                        }
                    }

                    if (!confirmed) {
                        console.warn(`⚠️ "${journalCategory.name}" may not have moved to position ${position} correctly after ${maxAttempts} attempts`);
                    }

                    position++;
                }

                // Final verification after all moves are complete
                await message.guild.channels.fetch();
                const finalJournalCategories = message.guild.channels.cache.filter(
                    channel => channel.type === ChannelType.GuildCategory &&
                    (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
                );

                const finalPositions = Array.from(finalJournalCategories.values())
                    .sort((a, b) => a.position - b.position)
                    .map(cat => `${cat.name} (pos: ${cat.position})`);

                console.log(`Final journal category positions: ${finalPositions.join(', ')}`);

                // Check if they're properly grouped after the new game
                const newGamePosition = category.position;
                const journalPositions = Array.from(finalJournalCategories.values()).map(cat => cat.position);
                const allAfterNewGame = journalPositions.every(pos => pos > newGamePosition);

                if (allAfterNewGame) {
                    console.log(`✅ All journal categories are properly positioned after the new game`);
                } else {
                    console.warn(`⚠️ Some journal categories may not be positioned correctly after the new game`);
                }
            }
        } catch (error) {
            console.error('Error moving journal categories after game category:', error);
            // Continue even if moving journal categories fails - game is still created successfully
        }
    }
};
