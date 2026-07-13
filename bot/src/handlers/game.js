'use strict';

const { ChannelType, EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

module.exports = {

async getServerChannelCapacity(serverId, guild, plannedNewChannels = 0) {
    const channelLimit = 500;

    // Prefer a fetch for accuracy (cache can be stale right after creates/deletes)
    let currentChannelsCount = guild.channels.cache.size;
    try {
        const channels = await guild.channels.fetch();
        if (channels && typeof channels.size === 'number') {
            currentChannelsCount = channels.size;
        }
    } catch (e) {
        // If fetch fails, fall back to cache size
    }

    let pendingToCreateCount = 0;
    try {
        const pendingResult = await this.db.query(
            `
            SELECT COUNT(*)::int AS total
            FROM game_channels gc
            JOIN games g ON g.id = gc.game_id
            WHERE g.server_id = $1
              AND g.status IN ('signup', 'active')
              AND gc.is_created = false
            `,
            [serverId]
        );
        pendingToCreateCount = pendingResult.rows?.[0]?.total ?? 0;
    } catch (e) {
        // If DB query fails, treat as unknown/0 rather than breaking server command
        pendingToCreateCount = 0;
    }

    const safePlannedNewChannels = Number.isFinite(plannedNewChannels) ? Math.max(0, Math.floor(plannedNewChannels)) : 0;
    const projectedTotal = currentChannelsCount + pendingToCreateCount + safePlannedNewChannels;
    const remainingNow = channelLimit - currentChannelsCount;
    const remainingProjected = channelLimit - projectedTotal;

    return {
        channelLimit,
        currentChannelsCount,
        pendingToCreateCount,
        plannedNewChannels: safePlannedNewChannels,
        projectedTotal,
        remainingNow,
        remainingProjected,
        isWithinLimitNow: currentChannelsCount <= channelLimit,
        isWithinLimitProjected: projectedTotal <= channelLimit,
    };
},

async handleSetup(message, args) {
    const serverId = message.guild.id;
    
    // Check if setup already exists
    const existingConfig = await this.db.query(
        'SELECT * FROM server_configs WHERE server_id = $1',
        [serverId]
    );

    if (existingConfig.rows.length > 0) {
        const embed = new EmbedBuilder()
            .setTitle('🔧 Server Already Configured')
            .setDescription('This server is already set up. Current configuration:')
            .addFields(
                { name: 'Game Prefix', value: existingConfig.rows[0].game_prefix, inline: true },
                { name: 'Game Counter', value: existingConfig.rows[0].game_counter.toString(), inline: true },
                { name: 'Game Name', value: existingConfig.rows[0].game_name || 'Not set', inline: true }
            )
            .setColor(0x00AE86);

        await message.reply({ embeds: [embed] });
        await message.reply('To reconfigure, respond to the setup prompt below with: `prefix startNumber [gameName]` (e.g., `g 534`). This will overwrite the current configuration.');
    }

    const embed = new EmbedBuilder()
        .setTitle('🔧 Server Setup')
        .setDescription('Please provide the following information:')
        .addFields(
            { name: '1. Game Prefix', value: 'What prefix should be used for channels? (e.g., "g", "o")', inline: false },
            { name: '2. Starting Number', value: 'What number should we start counting from? (e.g., 1)', inline: false },
            { name: '3. Game Name (Optional)', value: 'What should the games be called? (e.g., "Origins")', inline: false }
        )
        .setColor(0x3498DB)
        .setFooter({ text: 'Please respond with: prefix startNumber [gameName] - or type "cancel" to stop' });

    await message.reply({ embeds: [embed] });

    const filter = (m) => m.author.id === message.author.id && !m.author.bot;
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000 });

    if (!collected.size) {
        return message.reply('⏰ Setup timed out. Please try again.');
    }

    const rawResponse = collected.first().content.trim();

    if (rawResponse.toLowerCase() === 'cancel') {
        return message.reply('✋ Setup cancelled. No changes were made.');
    }

    const response = rawResponse.split(/ +/);
    const prefix = response[0];
    const startNumber = parseInt(response[1]);
    const gameName = response.slice(2).join(' ') || null;

    if (!prefix || isNaN(startNumber)) {
        return message.reply('❌ Invalid input. Please provide a valid prefix and starting number.');
    }

    await this.db.query(
        `INSERT INTO server_configs (server_id, game_prefix, game_counter, game_name) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (server_id) 
         DO UPDATE SET game_prefix = $2, game_counter = $3, game_name = $4`,
        [serverId, prefix, startNumber, gameName]
    );

    const successEmbed = new EmbedBuilder()
        .setTitle('✅ Setup Complete')
        .setDescription('Server configuration saved successfully!')
        .addFields(
            { name: 'Game Prefix', value: prefix, inline: true },
            { name: 'Starting Number', value: startNumber.toString(), inline: true },
            { name: 'Game Name', value: gameName || 'Not set', inline: true }
        )
        .setColor(0x00AE86);

    await message.reply({ embeds: [successEmbed] });
},

async handleCreate(message) {
    const serverId = message.guild.id;

    // Get server config
    const configResult = await this.db.query(
        'SELECT * FROM server_configs WHERE server_id = $1',
        [serverId]
    );

    if (!configResult.rows.length) {
        return message.reply('❌ Please run `Wolf.setup` first to configure the server.');
    }

    const config = configResult.rows[0];

    // Check if there's an active game
    const activeGameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3)',
        [serverId, 'signup', 'active']
    );

    if (activeGameResult.rows.length > 0) {
        return message.reply('❌ There is already an active game. Please finish the current game first.');
    }

    // Capacity check (Wolf.create will create: 1 category + 3 text channels)
    const plannedNewChannels = 4;
    const capacity = await this.getServerChannelCapacity(serverId, message.guild, plannedNewChannels);
    if (!capacity.isWithinLimitProjected) {
        return message.reply(
            [
                '❌ Not enough room to create a new game.',
                `- Channels (now): **${capacity.currentChannelsCount}/${capacity.channelLimit}**`,
                `- Queued (DB): **${capacity.pendingToCreateCount}**`,
                `- Planned by this command: **${capacity.plannedNewChannels}**`,
                `- Projected: **${capacity.projectedTotal}/${capacity.channelLimit}** (over by **${Math.abs(capacity.remainingProjected)}**)`,
            ].join('\n')
        );
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
    if (!modRole) {
        return message.reply('❌ Mod role not found. Run `Wolf.server_roles` first.');
    }

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
                deny: ['SendMessages', 'CreatePrivateThreads', 'CreatePublicThreads']
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
        permissionOverwrites: [
            {
                id: message.guild.roles.everyone.id,
                deny: ['CreatePrivateThreads', 'CreatePublicThreads']
            }
        ]
    });

    // Generate a credential that is independent from Discord identifiers.
    const { generateGamePassword, hashGamePassword } = require('../utils/game-password');
    const dashboardPassword = generateGamePassword();
    const dashboardPasswordHash = hashGamePassword(dashboardPassword);

    // Save game to database first and get the game ID
    const gameResult = await this.db.query(
        `INSERT INTO games (server_id, game_number, game_name, signup_channel_id, category_id, mod_chat_channel_id, dashboard_password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [serverId, config.game_counter, config.game_name, signupChannel.id, category.id, modChat.id, dashboardPasswordHash]
    );
    
    const gameId = gameResult.rows[0].id;

    // Update server config counter
    await this.db.query(
        'UPDATE server_configs SET game_counter = game_counter + 1 WHERE server_id = $1',
        [serverId]
    );

    // Build website management URL if WEBSITE_URL is configured
    const websiteUrl = process.env.WEBSITE_URL;
    let managementUrl = 'Not configured (WEBSITE_URL env variable missing)';
    let modManagementUrl = managementUrl;
    if (websiteUrl) {
        managementUrl = `${websiteUrl}/game/${gameId}`;
        modManagementUrl = `${managementUrl}?p=${encodeURIComponent(dashboardPassword)}`;
    }

    const embed = new EmbedBuilder()
        .setTitle('🎮 New Game Created!')
        .setDescription(`Game ${config.game_counter} has been created.`)
        .addFields(
            { name: 'Category', value: categoryName, inline: true },
            { name: 'Signup Channel', value: `<#${signupChannel.id}>`, inline: true },
            { name: '🌐 Management URL', value: `${managementUrl}`, inline: false },
            { name: '🔑 Password', value: 'Posted in the private mod chat.', inline: true },
            { name: '🆔 Game ID', value: `\`${gameId}\``, inline: true }
        )
        .setColor(0x00AE86);

    await message.reply({ embeds: [embed] });
    
    // Post management information in mod chat and pin it
    const modManagementEmbed = new EmbedBuilder()
        .setTitle('🌐 Game Management Information')
        .setDescription('Use this information to manage the game through the website.')
        .addFields(
            { name: '🌐 Management URL', value: modManagementUrl, inline: false },
            { name: '🔑 Password', value: `\`${dashboardPassword}\``, inline: true },
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
    await this.db.query(
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
},

async handleSignUp(message) {
    const serverId = message.guild.id;
    const user = message.author;

    // Check if user is suspended (has the "Suspended" role)
    if (message.member?.roles?.cache?.some(r => r.name === 'Suspended')) {
        return message.reply('❌ Suspended players cannot sign up for games.');
    }

    // Check if user is banned
    const bannedUser = await this.db.query(
        'SELECT * FROM banned_users WHERE user_id = $1',
        [user.id]
    );

    if (bannedUser.rows.length > 0) {
        return message.reply('❌ It would apear you are banned... uh oh...');
    }

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'signup']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game available for signups.');
    }

    const game = gameResult.rows[0];

    // Check if signups are closed
    if (game.signups_closed) {
        return message.reply('❌ Signups have been closed for this game.');
    }

    // Check if already signed up
    const existingPlayer = await this.db.query(
        'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
        [game.id, user.id]
    );

    if (existingPlayer.rows.length > 0) {
        return message.reply('❌ You are already signed up for this game.');
    }

    // Get display name (displayName property or fallback to username)
    const displayName = message.member?.displayName || user.displayName || user.username;

    // Add player to the database using display name
    await this.db.query(
        'INSERT INTO players (game_id, user_id, username) VALUES ($1, $2, $3)',
        [game.id, user.id, displayName]
    );

    // Check if user has a journal, create one if they don't
    this.ensureUserHasJournal(message, user);

    // Assign "Signed Up" role
    await this.assignRole(message.member, 'Signed Up');
    await this.removeRole(message.member, 'Spectator');

    // React with checkmark for success
    await message.react('✅');
    
    // Update signup message with current players
    await this.updateSignupMessage(game);
},

async handleSignOut(message) {
    const serverId = message.guild.id;
    const userId = message.author.id;

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'signup']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game available for signups.');
    }

    const game = gameResult.rows[0];

    // Check if signups are closed
    if (game.signups_closed) {
        return message.reply('There is no way to get off Mr. Bones\' Wild Ride (please ping a mod if you actually would like to leave)');
    }

    // Remove player
    const deleteResult = await this.db.query(
        'DELETE FROM players WHERE game_id = $1 AND user_id = $2',
        [game.id, userId]
    );

    if (deleteResult.rowCount === 0) {
        return message.reply('❌ You are not signed up for this game.');
    }

    // Remove "Signed Up" role
    await this.removeRole(message.member, 'Signed Up');
    await this.assignRole(message.member, 'Spectator');

    // React with checkmark for success
    await message.react('✅');
    
    // Update signup message with current players
    await this.updateSignupMessage(game);
},

async handleRemoveSignup(message, args) {
    const serverId = message.guild.id;

    if (!args.length) {
        return message.reply('❌ Usage: `Wolf.remove_signup <@user or user ID>`');
    }

    const mentionedUser = message.mentions.users.first();
    const rawArg = args[0].replace(/[<@!>]/g, '');
    const targetUserId = mentionedUser ? mentionedUser.id : (/^\d+$/.test(rawArg) ? rawArg : null);

    if (!targetUserId) {
        return message.reply('❌ Please provide a valid @mention or user ID.');
    }

    // Get game in signup phase
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'signup']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game available for signups.');
    }

    const game = gameResult.rows[0];

    // Remove player (works regardless of whether signups are closed - this is a mod override)
    const deleteResult = await this.db.query(
        'DELETE FROM players WHERE game_id = $1 AND user_id = $2 RETURNING username',
        [game.id, targetUserId]
    );

    if (deleteResult.rowCount === 0) {
        return message.reply('❌ That user is not signed up for this game.');
    }

    // Remove "Signed Up" role and restore Spectator, if the member can still be fetched
    // (they may have left the server, per feedback #90)
    try {
        const member = await message.guild.members.fetch(targetUserId);
        await this.removeRole(member, 'Signed Up');
        await this.assignRole(member, 'Spectator');
    } catch (error) {
        console.log(`Could not fetch member ${targetUserId} to update roles (may have left the server):`, error.message);
    }

    // React with checkmark for success
    await message.react('✅');
    await message.reply(`✅ Removed **${deleteResult.rows[0].username}** from signups.`);

    // Update signup message with current players
    await this.updateSignupMessage(game);
},

async updateSignupMessage(game) {
    try {
        // If we don't have a signup message ID, try to find it the old way as fallback
        if (!game.signup_message_id) {
            const signupChannel = await this.client.channels.fetch(game.signup_channel_id);
            let signupMessage = null;
            let lastMessageId = null;
            let searchAttempts = 0;
            const maxSearchAttempts = 50; // Prevent infinite loops (5000 messages max)
            
            // Keep searching through message history until we find a signup message
            while (!signupMessage && searchAttempts < maxSearchAttempts) {
                const fetchOptions = { limit: 100 };
                if (lastMessageId) {
                    fetchOptions.before = lastMessageId;
                }
                
                const messages = await signupChannel.messages.fetch(fetchOptions);
                if (messages.size === 0) {
                    break; // No more messages to search
                }
                
                // Look for a bot message with embeds that contains signup title
                signupMessage = messages.find(msg => 
                    msg.author.bot && 
                    msg.embeds.length > 0 && 
                    msg.embeds[0].title && 
                    msg.embeds[0].title.includes('Werewolf Game Signups')
                );
                
                if (!signupMessage) {
                    // Get the ID of the oldest message in this batch for the next iteration
                    lastMessageId = messages.last().id;
                    searchAttempts++;
                }
            }
            
            if (!signupMessage) {
                console.error('Could not find signup message for game:', game.id);
                return;
            }
            
            // Store the found message ID for future use
            await this.db.query(
                'UPDATE games SET signup_message_id = $1 WHERE id = $2',
                [signupMessage.id, game.id]
            );
            game.signup_message_id = signupMessage.id;
        }

        const signupChannel = await this.client.channels.fetch(game.signup_channel_id);
        const signupMessage = await signupChannel.messages.fetch(game.signup_message_id);

        if (!signupMessage) {
            console.error('Signup message not found with ID:', game.signup_message_id);
            return;
        }

        const playersResult = await this.db.query(
            'SELECT username FROM players WHERE game_id = $1 ORDER BY signed_up_at',
            [game.id]
        );

        const playersList = playersResult.rows.map((p, i) => `${i + 1}. ${p.username}`).join('\n') || 'No players signed up yet.';

        const embed = new EmbedBuilder()
            .setTitle('🐺 Werewolf Game Signups')
            .setDescription('A new game is starting! Use `Wolf.in` to join or `Wolf.out` to leave.')
            .addFields({ name: `Players (${playersResult.rows.length})`, value: playersList })
            .setColor(0x3498DB);

        await signupMessage.edit({ embeds: [embed] });
    } catch (error) {
        console.error('Error updating signup message:', error);
        // If the stored message ID is invalid, clear it from the database
        if (error.code === 10008) { // Unknown Message error
            await this.db.query(
                'UPDATE games SET signup_message_id = NULL WHERE id = $1',
                [game.id]
            );
        }
    }
},

async handleStart(message, args = []) {
    const serverId = message.guild.id;

    // Check for dark parameter
    const isDark = args.length > 0 && args[0].toLowerCase() === 'dark';

    // Get game in signup phase
    const gameResult = await this.db.query(
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

    const missingRoles = [['Alive', aliveRole], ['Dead', deadRole], ['Spectator', spectatorRole], ['Mod', modRole]]
        .filter(([, role]) => !role)
        .map(([name]) => name);
    if (missingRoles.length > 0) {
        return message.reply(`❌ Missing required roles: ${missingRoles.join(', ')}. Run \`Wolf.server_roles\` first.`);
    }

    const logPrefix = `[Wolf.start][server:${serverId}][game:${game.id}#${game.game_number}]`;
    const log = (...parts) => console.log(logPrefix, ...parts);
    const warn = (...parts) => console.warn(logPrefix, ...parts);
    const errorLog = (...parts) => console.error(logPrefix, ...parts);

    // Check if there are players
    const playersResult = await this.db.query(
        'SELECT COUNT(*) as count FROM players WHERE game_id = $1',
        [game.id]
    );

    if (parseInt(playersResult.rows[0].count) == 0) {
        return message.reply('❌ Need at least one player to start the game.');
    }

    // Get config for naming
    const configResult = await this.db.query(
        'SELECT * FROM server_configs WHERE server_id = $1',
        [serverId]
    );
    const config = configResult.rows[0];

    // Create/reuse game channels in the specified order
    const category = await this.client.channels.fetch(game.category_id);

    // Get signup channel to rename it later
    const signupChannel = await this.client.channels.fetch(game.signup_channel_id);
    log('Starting with isDark=', isDark, 'existing game channel IDs=', {
        results_channel_id: game.results_channel_id,
        memos_channel_id: game.memos_channel_id,
        town_square_channel_id: game.town_square_channel_id,
        voting_booth_channel_id: game.voting_booth_channel_id,
        wolf_chat_channel_id: game.wolf_chat_channel_id,
    });

    // Fetch channels for accurate existence checks (cache can be stale)
    let allChannels = message.guild.channels.cache;
    try {
        const fetched = await message.guild.channels.fetch();
        if (fetched) allChannels = fetched;
    } catch (e) {
        // fall back to cache
    }
    log('Fetched guild channels for existence checks. total=', allChannels.size);

    const findTextChannelInCategoryByName = (name) => {
        return allChannels.find(
            (c) =>
                c &&
                c.type === ChannelType.GuildText &&
                c.parentId === category.id &&
                c.name === name
        ) || null;
    };

    const fetchTextChannelById = async (channelId) => {
        if (!channelId) return null;
        try {
            const c = await message.guild.channels.fetch(channelId);
            if (!c || c.type !== ChannelType.GuildText) return null;
            return c;
        } catch (e) {
            return null;
        }
    };

    const ensureTextChannel = async ({ label, name, preferredId, permissionOverwrites }) => {
        let channel = null;
        let resolution = 'none';

        // 1) Prefer DB-stored channel id (most reliable)
        if (preferredId) {
            channel = await fetchTextChannelById(preferredId);
            if (channel) resolution = 'id';
        }

        // 2) Fallback: find by expected name within the game category (recovery / partial start)
        if (!channel) {
            channel = findTextChannelInCategoryByName(name);
            if (channel) resolution = 'name';
        }

        // 3) Create if missing
        if (!channel) {
            channel = await message.guild.channels.create({
                name,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites
            });
            resolution = 'created';
        } else {
            // If the channel exists but isn't under the game category, move it back so we truly "reuse"
            if (channel.parentId !== category.id) {
                try {
                    await channel.setParent(category.id, { lockPermissions: false });
                    log(`${label}: moved existing channel under game category`, { id: channel.id, name: channel.name });
                } catch (e) {
                    warn(`${label}: could not move channel under game category`, { id: channel.id, name: channel.name });
                }
            }
            // Keep permissions consistent even if the channel existed from a previous/partial start
            if (permissionOverwrites) {
                try {
                    await channel.permissionOverwrites.set(permissionOverwrites);
                } catch (e) {
                    warn(`${label}: failed to set permission overwrites`, { id: channel.id, name: channel.name });
                }
            }
        }

        log(`${label}: resolved`, { resolution, id: channel.id, name: channel.name });
        return channel;
    };

    // If there are DB-queued channels that already exist in Discord, mark them as created so capacity checks don't over-count
    try {
        const pendingExistingResult = await this.db.query(
            'SELECT channel_name, channel_id FROM game_channels WHERE game_id = $1 AND is_created = $2',
            [game.id, false]
        );
        let markedCreated = 0;
        let markedCreatedById = 0;
        let markedCreatedByName = 0;
        for (const row of pendingExistingResult.rows) {
            let existing = null;
            if (row.channel_id) {
                existing = await fetchTextChannelById(row.channel_id);
                if (existing) markedCreatedById++;
            }
            if (!existing) {
                existing = findTextChannelInCategoryByName(row.channel_name);
                if (existing) markedCreatedByName++;
            }
            if (!existing) continue;
            try {
                if (existing.parentId !== category.id) {
                    await existing.setParent(category.id, { lockPermissions: false }).catch(() => {});
                }
                await this.db.query(
                    'UPDATE game_channels SET channel_id = $1, is_created = $2 WHERE game_id = $3 AND channel_name = $4',
                    [existing.id, true, game.id, row.channel_name]
                );
                markedCreated++;
            } catch (e) {
                // Non-fatal; worst case we over-count pending channels in capacity check
            }
        }
        if (pendingExistingResult.rows.length) {
            log('Pending channel reconciliation complete', {
                pendingRows: pendingExistingResult.rows.length,
                markedCreated,
                markedCreatedById,
                markedCreatedByName
            });
        }
    } catch (e) {
        // ignore
    }

    // Capacity check (Wolf.start will create core channels: results, memos, townsquare, voting-booth, wolf-chat)
    // Plus any DB-queued channels tracked as game_channels.is_created=false (counted in getServerChannelCapacity)
    // We only count core channels that are missing, since we now reuse existing channels by id/name.
    const corePlan = [
        { label: 'Results', name: `${config.game_prefix}${game.game_number}-results`, preferredId: game.results_channel_id },
        { label: 'Player Memos', name: `${config.game_prefix}${game.game_number}-player-memos`, preferredId: game.memos_channel_id },
        { label: 'Town Square', name: `${config.game_prefix}${game.game_number}-townsquare`, preferredId: game.town_square_channel_id },
        { label: 'Voting Booth', name: `${config.game_prefix}${game.game_number}-voting-booth`, preferredId: game.voting_booth_channel_id },
        { label: 'Wolf Chat', name: `${config.game_prefix}${game.game_number}-wolf-chat`, preferredId: game.wolf_chat_channel_id },
    ];
    let plannedNewChannels = 0;
    for (const c of corePlan) {
        const byId = c.preferredId ? (await fetchTextChannelById(c.preferredId)) : null;
        if (byId) continue;
        const byName = findTextChannelInCategoryByName(c.name);
        if (byName) continue;
        plannedNewChannels++;
    }
    const capacity = await this.getServerChannelCapacity(serverId, message.guild, plannedNewChannels);
    log('Capacity check', {
        plannedNewChannels,
        currentChannelsCount: capacity.currentChannelsCount,
        pendingToCreateCount: capacity.pendingToCreateCount,
        projectedTotal: capacity.projectedTotal,
        channelLimit: capacity.channelLimit,
        isWithinLimitProjected: capacity.isWithinLimitProjected
    });
    if (!capacity.isWithinLimitProjected) {
        return message.reply(
            [
                '❌ Not enough room to start the game (Discord limit: 500 channels/server).',
                `- Channels (now): **${capacity.currentChannelsCount}/${capacity.channelLimit}**`,
                `- Queued (DB): **${capacity.pendingToCreateCount}**`,
                `- Planned by this command: **${capacity.plannedNewChannels}**`,
                `- Projected: **${capacity.projectedTotal}/${capacity.channelLimit}** (over by **${Math.abs(capacity.remainingProjected)}**)`,
            ].join('\n')
        );
    }

    // 1. Breakdown is already created on Wolf.create and will be at the top of the category

    // 2. Results - Only Mod can type, everyone else can see but not type
    const results = await ensureTextChannel({
        label: 'Results',
        name: `${config.game_prefix}${game.game_number}-results`,
        preferredId: game.results_channel_id,
        permissionOverwrites: [
            {
                id: message.guild.roles.everyone.id,
                deny: ['ViewChannel', 'SendMessages', 'CreatePrivateThreads', 'CreatePublicThreads']
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
    try {
        await results.setPosition(signupChannel.position); // Position results above the signup channel
    } catch (e) {}

    // 3. Player-memos - Alive can see and type (unless dark mode), Dead can see but not type, Spectators can see but not type, Mods can see and type
    const memos = await ensureTextChannel({
        label: 'Player Memos',
        name: `${config.game_prefix}${game.game_number}-player-memos`,
        preferredId: game.memos_channel_id,
        permissionOverwrites: [
            {
                id: message.guild.roles.everyone.id,
                deny: ['ViewChannel', 'SendMessages', 'CreatePrivateThreads', 'CreatePublicThreads']
            },
            {
                id: aliveRole.id,
                allow: isDark ? [] : ['ViewChannel', 'SendMessages'],
                deny: isDark ? ['ViewChannel', 'SendMessages'] : []
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
    try {
        await memos.setPosition(results.position + 1); // Position memos below results
    } catch (e) {}

    // 4. Townsquare - Alive can see and type (unless dark mode), Dead can see but not type, Spectators can see but not type, Mods can see and type
    const townSquare = await ensureTextChannel({
        label: 'Town Square',
        name: `${config.game_prefix}${game.game_number}-townsquare`,
        preferredId: game.town_square_channel_id,
        permissionOverwrites: [
            {
                id: message.guild.roles.everyone.id,
                deny: ['ViewChannel', 'SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']
            },
            {
                id: aliveRole.id,
                allow: isDark ? [] : ['ViewChannel', 'SendMessages'],
                deny: isDark ? ['ViewChannel', 'SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'] : ['CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']
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
    try {
        await townSquare.setPosition(memos.position + 1); // Position town square below memos
    } catch (e) {}

    // 5. Voting-Booth (starts locked for night phase) - All can see but none can type initially (unless dark mode, then Alive cannot see)
    const votingBooth = await ensureTextChannel({
        label: 'Voting Booth',
        name: `${config.game_prefix}${game.game_number}-voting-booth`,
        preferredId: game.voting_booth_channel_id,
        permissionOverwrites: [
            {
                id: message.guild.roles.everyone.id,
                deny: ['ViewChannel', 'SendMessages', 'CreatePrivateThreads', 'CreatePublicThreads']
            },
            {
                id: aliveRole.id,
                allow: isDark ? [] : ['ViewChannel'],
                deny: isDark ? ['ViewChannel', 'SendMessages'] : ['SendMessages']
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
    try {
        await votingBooth.setPosition(townSquare.position + 1); // Position voting booth below town square
    } catch (e) {}

    // 6. <added channels> will be positioned here when created with Wolf.add_channel

    // 7. Wolf-Chat - Mods can see and type, Spectators can see but not type, Alive cannot see but can type (for wolves), everyone else cannot see
    const wolfChat = await ensureTextChannel({
        label: 'Wolf Chat',
        name: `${config.game_prefix}${game.game_number}-wolf-chat`,
        preferredId: game.wolf_chat_channel_id,
        permissionOverwrites: [
            {
                id: message.guild.roles.everyone.id,
                deny: ['ViewChannel', 'SendMessages', 'CreatePrivateThreads', 'CreatePublicThreads']
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
    try {
        await wolfChat.setPosition(votingBooth.position + 1); // Position wolf chat below voting booth
    } catch (e) {}

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
    const signedUpPlayers = await this.db.query(
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
                await this.removeRole(member, 'Signed Up');
                await this.assignRole(member, 'Alive');
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
                await this.removeRole(member, 'Signed Up');
                await this.assignRole(member, 'Alive');
            }
        } catch (error) {
            console.error(`Error updating role for player ${player.user_id}:`, error);
        }
    }

    // Channel permissions are now set during channel creation

    // Create channels for game_channels records where is_created is false
    try {
        const pendingChannelsResult = await this.db.query(
            'SELECT channel_name, day_message, night_message, invited_users, open_at_dusk FROM game_channels WHERE game_id = $1 AND is_created = $2',
            [game.id, false]
        );

        for (const channelData of pendingChannelsResult.rows) {
            try {
                // Create the channel with the same permissions as handleAddChannel
                const newChannel = await ensureTextChannel({
                    label: `Extra Channel "${channelData.channel_name}"`,
                    name: channelData.channel_name,
                    preferredId: channelData.channel_id,
                    permissionOverwrites: [
                        {
                            id: message.guild.roles.everyone.id,
                            deny: ['ViewChannel', 'SendMessages', 'CreatePrivateThreads', 'CreatePublicThreads']
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
                        }
                    ]
                });

                // Alive shouldnt see the channel at all but can send messages if open_at_dusk is true
                await newChannel.permissionOverwrites.edit(aliveRole.id, {
                    ViewChannel: false,
                    SendMessages: !!channelData.open_at_dusk,
                    AddReactions: !!channelData.open_at_dusk
                });

                // Position the channel between voting booth and wolf chat (same as handleAddChannel)
                try {
                    if (wolfChat) {
                        await newChannel.setPosition(wolfChat.position);
                        console.log(`Positioned new channel "${channelData.channel_name}" before wolf chat`);
                    }
                } catch (positionError) {
                    console.error('Error positioning new channel:', positionError);
                }

                // Update the database record with the channel ID and mark as created
                await this.db.query(
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
        const channelsWithInvitesResult = await this.db.query(
            'SELECT invited_users, channel_name, channel_id FROM game_channels WHERE game_id = $1 AND invited_users IS NOT NULL AND is_created = true',
            [game.id]
        );

        for (const channelData of channelsWithInvitesResult.rows) {
            if (channelData.invited_users && Array.isArray(channelData.invited_users)) {
                // Get the channel object
                const channel = await this.client.channels.fetch(channelData.channel_id);
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
    await this.db.query(
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
    log('Updated game row with core channel IDs + set active');

    // Pin a town-square anchor so players/mods can scroll back to the start of the game (feedback #40)
    try {
        const anchorMsg = await townSquare.send({
            content: '📌 **LET THE KILLING BEGIN**'
        });
        await anchorMsg.pin('Game start anchor for town square');
    } catch (anchorErr) {
        console.warn('[Game start] Could not post or pin town square anchor message:', anchorErr?.message || anchorErr);
    }

    // Send player list to dead chat
    await this.sendPlayerListToDeadChat(game.id, signupChannel);

    // Send role assignments to player journals
    const journalNotificationResults = await this.sendRoleNotificationsToJournals(game.id, serverId);

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
    if (journalNotificationResults.failed > 0 || journalNotificationResults.sent > 0 || journalNotificationResults.wolvesAddedToChat > 0 || journalNotificationResults.wolvesFailedToAdd > 0) {
        let notificationSummary = `• ${journalNotificationResults.sent} players notified in journals`;
        if (journalNotificationResults.wolvesAddedToChat > 0) {
            notificationSummary += `\n• ${journalNotificationResults.wolvesAddedToChat} wolves added to wolf chat`;
        }
        if (journalNotificationResults.wolvesFailedToAdd > 0) {
            notificationSummary += `\n• ⚠️ ${journalNotificationResults.wolvesFailedToAdd} wolves failed to add to wolf chat`;
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
},

};
