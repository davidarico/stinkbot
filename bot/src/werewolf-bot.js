const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const moment = require('moment-timezone');

class WerewolfBot {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.prefix = process.env.BOT_PREFIX || 'Wolf.';
    }

    async handleMessage(message) {
        // Check if message starts with prefix (case insensitive)
        const prefix = process.env.BOT_PREFIX || 'Wolf.';
        if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) {
            return;
        }

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // Commands that anyone can use
        const playerCommands = ['in', 'out', 'vote', 'retract', 'alive', 'peed', 'help', 'meme'];
        
        // Check permissions for admin-only commands
        if (!playerCommands.includes(command) && !this.hasModeratorPermissions(message.member)) {
            return;
        }

        try {
            switch (command) {
                case 'setup':
                    await this.handleSetup(message, args);
                    break;
                case 'create':
                    await this.handleCreate(message);
                    break;
                case 'in':
                    await this.handleSignUp(message);
                    break;
                case 'out':
                    await this.handleSignOut(message);
                    break;
                case 'start':
                    await this.handleStart(message);
                    break;
                case 'vote':
                    await this.handleVote(message, args);
                    break;
                case 'retract':
                    await this.handleRetract(message);
                    break;
                case 'next':
                    await this.handleNext(message);
                    break;
                case 'end':
                    await this.handleEnd(message);
                    break;
                case 'help':
                    await this.handleHelp(message);
                    break;
                case 'refresh':
                    await this.handleRefresh(message);
                    break;
                case 'server_roles':
                    await this.handleServerRoles(message);
                    break;
                case 'alive':
                    await this.handleAlive(message);
                    break;
                case 'inlist':
                    await this.handleInList(message);
                    break;
                case 'add_channel':
                    await this.handleAddChannel(message, args);
                    break;
                case 'issues':
                    await this.handleIssues(message);
                    break;
                case 'recovery':
                    await this.handleRecovery(message);
                    break;
                case 'journal':
                    await this.handleJournal(message, args);
                    break;
                case 'journal_link':
                    await this.handleJournalLink(message);
                    break;
                case 'journal_owner':
                    await this.handleJournalOwner(message);
                    break;
                case 'journal_unlink':
                    await this.handleJournalUnlink(message);
                    break;
                case 'journal_assign':
                    await this.handleJournalAssign(message, args);
                    break;
                case 'server':
                    await this.handleServer(message);
                    break;
                case 'role_assign':
                    await this.handleRoleAssign(message, args);
                    break;
                case 'roles_list':
                    await this.handleRolesList(message);
                    break;
                case 'my_journal':
                    await this.handleMyJournal(message);
                    break;
                case 'ia':
                    await this.handleIA(message, args);
                    break;
                case 'speed':
                    await this.handleSpeed(message, args);
                    break;
                case 'speed_check':
                    await this.handleSpeedCheck(message);
                    break;
                case 'settings':
                    await this.handleSettings(message, args);
                    break;
                case 'create_vote':
                    await this.handleCreateVote(message);
                    break;
                case 'get_votes':
                    await this.handleGetVotes(message);
                    break;
                case 'meme':
                    await this.handleMeme(message);
                    break;
                case 'peed':
                    await message.reply('💦 IM PISSING REALLY HARD AND ITS REALLY COOL 💦');
                    break;
                case 'mylo':
                    await message.reply('Mylo can maybe backpedal to Orphan if we need to if this doesn\'t land')
                    break;
                default:
                    await message.reply('❓ Unknown command bozo.');
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await message.reply('❌ An error occurred while processing your command.');
        }
    }

    hasModeratorPermissions(member) {
        return member.permissions.has(PermissionFlagsBits.ManageChannels) || 
               member.permissions.has(PermissionFlagsBits.Administrator);
    }

    async assignRole(member, roleName) {
        try {
            const role = member.guild.roles.cache.find(r => r.name === roleName);
            if (role && !member.roles.cache.has(role.id)) {
                await member.roles.add(role);
                console.log(`Assigned role "${roleName}" to ${member.displayName}`);
            }
        } catch (error) {
            console.error(`Error assigning role "${roleName}":`, error);
        }
    }

    async removeRole(member, roleName) {
        try {
            const role = member.guild.roles.cache.find(r => r.name === roleName);
            if (role && member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
                console.log(`Removed role "${roleName}" from ${member.displayName}`);
            }
        } catch (error) {
            console.error(`Error removing role "${roleName}":`, error);
        }
    }

    async assignSpectatorRole(member) {
        // Remove all game roles and assign spectator
        await this.removeRole(member, 'Signed Up');
        await this.removeRole(member, 'Alive');
        await this.removeRole(member, 'Dead');
        await this.assignRole(member, 'Spectator');
    }

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
            await message.reply('To reconfigure, please use the setup command with new parameters.');
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
            .setFooter({ text: 'Please respond with: prefix startNumber [gameName]' });

        await message.reply({ embeds: [embed] });

        const filter = (m) => m.author.id === message.author.id && !m.author.bot;
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000 });

        if (!collected.size) {
            return message.reply('⏰ Setup timed out. Please try again.');
        }

        const response = collected.first().content.trim().split(/ +/);
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
    }

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
        const gameResult = await this.db.query(
            `INSERT INTO games (server_id, game_number, game_name, signup_channel_id, category_id, mod_chat_channel_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [serverId, config.game_counter, config.game_name, signupChannel.id, category.id, modChat.id]
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
        if (websiteUrl) {
            managementUrl = `${websiteUrl}/game/${gameId}`;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎮 New Game Created!')
            .setDescription(`Game ${config.game_counter} has been created.`)
            .addFields(
                { name: 'Category', value: categoryName, inline: true },
                { name: 'Signup Channel', value: `<#${signupChannel.id}>`, inline: true },
                { name: '🌐 Management URL', value: managementUrl, inline: false },
                { name: '🔑 Password', value: `\`${category.id}\``, inline: true },
                { name: '🆔 Game ID', value: `\`${gameId}\``, inline: true }
            )
            .setColor(0x00AE86);

        await message.reply({ embeds: [embed] });
        
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
    }

    async handleSignUp(message) {
        const serverId = message.guild.id;
        const user = message.author;

        // Get active game
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'signup']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game available for signups.');
        }

        const game = gameResult.rows[0];

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

        // Assign "Signed Up" role
        await this.assignRole(message.member, 'Signed Up');
        await this.removeRole(message.member, 'Spectator');

        // React with checkmark for success
        await message.react('✅');
        
        // Update signup message with current players
        await this.updateSignupMessage(game);
    }

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
    }

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
    }

    async handleStart(message) {
        const serverId = message.guild.id;

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

        // Create game channels in the specified order
        const category = await this.client.channels.fetch(game.category_id);

        // Get signup channel to rename it later
        const signupChannel = await this.client.channels.fetch(game.signup_channel_id);

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
        await signupChannel.permissionOverwrites.edit(message.guild.roles.everyone.id, {
            ViewChannel: false,
            SendMessages: false
        });
        await signupChannel.permissionOverwrites.edit(deadRole.id, {
            ViewChannel: true,
            SendMessages: true
        });
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

        for (const player of signedUpPlayers.rows) {
            try {
                const member = await message.guild.members.fetch(player.user_id);
                await this.removeRole(member, 'Signed Up');
                await this.assignRole(member, 'Alive');
            } catch (error) {
                console.error(`Error updating role for player ${player.user_id}:`, error);
            }
        }

        // Channel permissions are now set during channel creation

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
        if (journalNotificationResults.failed > 0 || journalNotificationResults.sent > 0) {
            embed.addFields({
                name: '📔 Role Notifications',
                value: `• ${journalNotificationResults.sent} players notified in journals\n• ${journalNotificationResults.failed} players failed to notify${journalNotificationResults.failed > 0 ? ' (no journal or no role assigned)' : ''}`,
                inline: false
            });
        }

        await message.reply({ embeds: [embed] });
    }

    async createVotingMessage(gameId, votingChannel) {
        try {
            // Get the current game to check day number and votes to hang
            const gameResult = await this.db.query('SELECT day_number, votes_to_hang FROM games WHERE id = $1', [gameId]);
            const dayNumber = gameResult.rows[0]?.day_number || 1;
            const votesToHang = gameResult.rows[0]?.votes_to_hang || 4;
            
            // Unpin any existing pinned messages in the voting channel
            try {
                const pinnedMessages = await votingChannel.messages.fetchPinned();
                for (const [messageId, pinnedMessage] of pinnedMessages) {
                    if (pinnedMessage.author.bot && 
                        pinnedMessage.embeds.length > 0 && 
                        pinnedMessage.embeds[0].title && 
                        pinnedMessage.embeds[0].title.includes('Voting')) {
                        await pinnedMessage.unpin();
                        console.log(`[DEBUG] Unpinned old voting message ${messageId}`);
                    }
                }
            } catch (error) {
                console.error('Error unpinning old voting messages:', error);
                // Continue even if unpinning fails
            }
            
            const embed = new EmbedBuilder()
                .setTitle(`🗳️ Day ${dayNumber} Voting`)
                .setDescription(`Use \`Wolf.vote @user\` to vote for someone.\nUse \`Wolf.retract\` to retract your vote.\n\n**Votes needed to hang: ${votesToHang}**`)
                .addFields({ name: 'Current Votes', value: 'No votes yet.' })
                .setColor(0xE74C3C);

            const votingMessage = await votingChannel.send({ embeds: [embed] });
            
            // Pin the new voting message
            try {
                await votingMessage.pin();
                console.log(`[DEBUG] Pinned new voting message ${votingMessage.id}`);
            } catch (error) {
                console.error('Error pinning voting message:', error);
                // Continue even if pinning fails
            }
            
            // Store the voting message ID in the database
            const updateResult = await this.db.query(
                'UPDATE games SET voting_message_id = $1 WHERE id = $2',
                [votingMessage.id, gameId]
            );
            
            console.log(`[DEBUG] Created voting message ${votingMessage.id} for game ${gameId}, database update affected ${updateResult.rowCount} rows`);
            
        } catch (error) {
            console.error('Error creating voting message:', error);
            throw error;
        }
    }

    async handleCreateVote(message) {
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

        // Check if it's day phase and day 2+ (when voting is allowed)
        if (game.day_phase === 'night') {
            return message.reply('❌ Voting messages can only be created during the day phase.');
        }

        try {
            const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
            
            // Create the new voting message (this will overwrite the stored ID)
            await this.createVotingMessage(game.id, votingChannel);
            
            // Get the updated game data with the new voting message ID
            const updatedGameResult = await this.db.query(
                'SELECT * FROM games WHERE server_id = $1 AND status = $2',
                [serverId, 'active']
            );
            const updatedGame = updatedGameResult.rows[0];
            
            // Immediately update the voting message with current votes
            await this.updateVotingMessage(updatedGame);
            
            await message.reply('✅ Voting message created successfully!');
            
        } catch (error) {
            console.error('Error creating voting message:', error);
            await message.reply('❌ An error occurred while creating the voting message.');
        }
    }

    async handleGetVotes(message) {
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

        // Check if it's day phase
        if (game.day_phase === 'night') {
            return message.reply('❌ Voting is not active during the night phase.');
        }

        if (game.day_number < 2) {
            return message.reply('❌ Voting is not allowed on Day 1.');
        }

        try {
            // Get current votes
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

            // Get voting message status
            let votingMessageStatus = '❌ No voting message found';
            if (game.voting_message_id) {
                try {
                    const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
                    const votingMessage = await votingChannel.messages.fetch(game.voting_message_id);
                    if (votingMessage) {
                        votingMessageStatus = `✅ Active voting message: [${game.voting_message_id}]`;
                    }
                } catch (error) {
                    votingMessageStatus = `⚠️ Stored voting message not found: ${game.voting_message_id}`;
                }
            }

            let voteText = 'No votes cast yet.';
            if (votesResult.rows.length > 0) {
                voteText = votesResult.rows.map(row => {
                    const voters = row.voters.split(', ').map(voter => `- ${voter}`).join('\n');
                    return `**${row.target_username}** (${row.vote_count})\n${voters}`;
                }).join('\n\n');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🗳️ Day ${game.day_number} Vote Status`)
                .setDescription(`**Game Phase:** ${game.day_phase === 'day' ? '🌞 Day' : '🌙 Night'} ${game.day_number}\n**Votes needed to hang:** ${game.votes_to_hang}\n**Voting Message:** ${votingMessageStatus}`)
                .addFields({ name: 'Current Votes', value: voteText })
                .setColor(0x3498DB)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error getting vote status:', error);
            await message.reply('❌ An error occurred while retrieving vote status.');
        }
    }

    async sendPlayerListToDeadChat(gameId, deadChatChannel) {
        // Get all players in the game
        const playersResult = await this.db.query(
            'SELECT username FROM players WHERE game_id = $1 ORDER BY username',
            [gameId]
        );

        if (playersResult.rows.length === 0) {
            return;
        }

        const playerList = playersResult.rows.map(player => `• ${player.username}`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle('👥 Player List')
            .setDescription(`Here are all the players in this game:\n\n${playerList}`)
            .setColor(0x9B59B6);

        await deadChatChannel.send({ embeds: [embed] });
    }

    async sendRoleNotificationsToJournals(gameId, serverId) {
        let sent = 0;
        let failed = 0;

        try {
            // Get all players in the game with their roles
            const playersResult = await this.db.query(
                'SELECT user_id, username, role FROM players WHERE game_id = $1',
                [gameId]
            );

            for (const player of playersResult.rows) {
                try {
                    // Skip players without assigned roles
                    if (!player.role) {
                        failed++;
                        console.log(`Skipping ${player.username} - no role assigned`);
                        continue;
                    }

                    // Check if player has a journal
                    const journalResult = await this.db.query(
                        'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
                        [serverId, player.user_id]
                    );

                    if (journalResult.rows.length === 0) {
                        failed++;
                        console.log(`Skipping ${player.username} - no journal found`);
                        continue;
                    }

                    const channelId = journalResult.rows[0].channel_id;

                    // Verify the journal channel still exists
                    const journalChannel = await this.client.channels.fetch(channelId);
                    if (!journalChannel) {
                        // Journal channel was deleted, clean up database
                        await this.db.query(
                            'DELETE FROM player_journals WHERE server_id = $1 AND user_id = $2',
                            [serverId, player.user_id]
                        );
                        failed++;
                        console.log(`Skipping ${player.username} - journal channel deleted`);
                        continue;
                    }

                    // Create role notification embed
                    const roleEmbed = new EmbedBuilder()
                        .setTitle('🎭 Your Role Assignment')
                        .setDescription(`The game has started! You have been assigned the role of **${player.role}**.`)
                        .setColor(0x9B59B6)
                        .setTimestamp()
                        .setFooter({ text: 'Good luck and have fun!' });

                    // Send the role notification to the journal
                    await journalChannel.send({
                        content: `<@${player.user_id}>`,
                        embeds: [roleEmbed]
                    });

                    sent++;
                    console.log(`Sent role notification to ${player.username}: ${player.role}`);

                } catch (error) {
                    console.error(`Error sending role notification to ${player.username}:`, error);
                    failed++;
                }
            }

        } catch (error) {
            console.error('Error in sendRoleNotificationsToJournals:', error);
        }

        return { sent, failed };
    }

    async handleVote(message, args) {
        const serverId = message.guild.id;
        const voterId = message.author.id;

        // Get active game
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Check if it's day phase
        if (game.day_phase === 'night') {
            return message.reply('❌ Voting is not allowed during the night phase.');
        }

        // Check if in voting booth
        if (message.channel.id !== game.voting_booth_channel_id) {
            const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
            return message.reply(`❌ Please vote in ${votingChannel} instead.`);
        }

        // Check if voter is in the game and has Alive role
        const voterCheck = await this.db.query(
            'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
            [game.id, voterId]
        );

        if (!voterCheck.rows.length) {
            return message.reply('❌ You are not in this game.');
        }

        // Check if voter has Alive role
        const voterMember = message.member;
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        if (!aliveRole || !voterMember.roles.cache.has(aliveRole.id)) {
            return message.reply('❌ You are not an alive player in this game.');
        }

        // Parse target
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('❌ Please mention a user to vote for.');
        }

        // Check if user is trying to vote for themselves
        if (target.id === voterId && process.env.NODE_ENV !== 'development') {
            return message.reply('❌ You cannot vote for yourself.');
        }

        // Check if target is in the game and has Alive role
        const targetCheck = await this.db.query(
            'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
            [game.id, target.id]
        );

        if (!targetCheck.rows.length) {
            return message.reply('❌ That player is not in this game.');
        }

        // Check if target has Alive role
        const targetMember = await message.guild.members.fetch(target.id).catch(() => null);
        if (!targetMember) {
            return message.reply('❌ Could not find that user in this server.');
        }

        if (!aliveRole || !targetMember.roles.cache.has(aliveRole.id)) {
            return message.reply('❌ That player is not an alive player in this game.');
        }

        // Remove existing vote if any
        await this.db.query(
            'DELETE FROM votes WHERE game_id = $1 AND voter_user_id = $2 AND day_number = $3',
            [game.id, voterId, game.day_number]
        );

        // Add new vote
        await this.db.query(
            'INSERT INTO votes (game_id, voter_user_id, target_user_id, day_number) VALUES ($1, $2, $3, $4)',
            [game.id, voterId, target.id, game.day_number]
        );

        // React with checkmark for success
        await message.react('✅');
        
        // Update voting message
        await this.updateVotingMessage(game);
    }

    async handleRetract(message) {
        const serverId = message.guild.id;
        const voterId = message.author.id;

        // Get active game
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Check if in voting booth
        if (message.channel.id !== game.voting_booth_channel_id) {
            const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
            return message.reply(`❌ Please retract your vote in ${votingChannel} instead.`);
        }

        // Remove vote
        const deleteResult = await this.db.query(
            'DELETE FROM votes WHERE game_id = $1 AND voter_user_id = $2 AND day_number = $3',
            [game.id, voterId, game.day_number]
        );

        if (deleteResult.rowCount === 0) {
            return message.reply('❌ You have no vote to retract.');
        }

        // React with checkmark for success
        await message.react('✅');
        
        // Update voting message
        await this.updateVotingMessage(game);
    }

    async updateVotingMessage(game) {
        try {
            // If we don't have a voting message ID, try to find it the old way as fallback
            if (!game.voting_message_id) {
                const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
                let votingMessage = null;
                let lastMessageId = null;
                let searchAttempts = 0;
                const maxSearchAttempts = 50; // Prevent infinite loops (5000 messages max)
                
                // Keep searching through message history until we find a voting message
                while (!votingMessage && searchAttempts < maxSearchAttempts) {
                    const fetchOptions = { limit: 100 };
                    if (lastMessageId) {
                        fetchOptions.before = lastMessageId;
                    }
                    
                    const messages = await votingChannel.messages.fetch(fetchOptions);
                    if (messages.size === 0) {
                        // No more messages to search
                        break;
                    }
                    
                    // Look for a bot message with embeds that contains voting title
                    votingMessage = messages.find(msg => 
                        msg.author.bot && 
                        msg.embeds.length > 0 && 
                        msg.embeds[0].title && 
                        msg.embeds[0].title.includes('Voting')
                    );
                    
                    if (!votingMessage) {
                        // Get the ID of the oldest message in this batch for next iteration
                        lastMessageId = messages.last().id;
                        searchAttempts++;
                    }
                }
                
                if (!votingMessage) {
                    console.log(`No voting message found in channel history after searching ${searchAttempts * 100} messages`);
                    return;
                }
                
                // Store the found message ID for future use
                await this.db.query(
                    'UPDATE games SET voting_message_id = $1 WHERE id = $2',
                    [votingMessage.id, game.id]
                );
                game.voting_message_id = votingMessage.id;
            }

            const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
            const votingMessage = await votingChannel.messages.fetch(game.voting_message_id);

            if (!votingMessage) {
                console.error('Voting message not found with ID:', game.voting_message_id);
                return;
            }

            // Get current votes
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

            let voteText = 'No votes yet.';
            if (votesResult.rows.length > 0) {
                voteText = votesResult.rows.map(row => {
                    const voters = row.voters.split(', ').map(voter => `- ${voter}`).join('\n');
                    return `**${row.target_username}** (${row.vote_count})\n${voters}`;
                }).join('\n\n');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🗳️ Day ${game.day_number} Voting`)
                .setDescription(`Use \`Wolf.vote @user\` to vote for someone.\nUse \`Wolf.retract\` to retract your vote.\n\n**Votes needed to hang: ${game.votes_to_hang}**`)
                .addFields({ name: 'Current Votes', value: voteText })
                .setColor(0xE74C3C);

            await votingMessage.edit({ embeds: [embed] });
        } catch (error) {
            console.error('Error updating voting message:', error);
            // If the stored message ID is invalid, clear it from the database
            if (error.code === 10008) { // Unknown Message error
                await this.db.query(
                    'UPDATE games SET voting_message_id = NULL WHERE id = $1',
                    [game.id]
                );
            }
        }
    }

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

            // Clear all votes for the game at the end of each day
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
                            await channel.permissionOverwrites.edit(aliveRole.id, {
                                SendMessages: false
                            });
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
    }

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
    }

    async handleServerRoles(message) {
        const guild = message.guild;

        try {
            // Define the roles we need to create
            const rolesToCreate = [
                {
                    name: 'Mod',
                    color: '#FF0000', // Red
                    permissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
                    description: 'Moderator role with admin permissions'
                },
                {
                    name: 'Spectator',
                    color: '#808080', // Gray
                    permissions: [],
                    description: 'Default role for new members'
                },
                {
                    name: 'Signed Up',
                    color: '#FFFF00', // Yellow
                    permissions: [],
                    description: 'Players who have signed up for the game'
                },
                {
                    name: 'Alive',
                    color: '#00FF00', // Green
                    permissions: [],
                    description: 'Players who are alive in the game'
                },
                {
                    name: 'Dead',
                    color: '#000000', // Black
                    permissions: [],
                    description: 'Players who are dead in the game'
                }
            ];

            let createdRoles = 0;
            let existingRoles = 0;
            const roleResults = [];

            // Create or verify each role exists
            for (const roleData of rolesToCreate) {
                let role = guild.roles.cache.find(r => r.name === roleData.name);
                
                if (!role) {
                    try {
                        role = await guild.roles.create({
                            name: roleData.name,
                            color: roleData.color,
                            permissions: roleData.permissions,
                            reason: 'Werewolf bot role setup'
                        });
                        createdRoles++;
                        roleResults.push(`✅ Created: **${roleData.name}**`);
                    } catch (error) {
                        roleResults.push(`❌ Failed to create: **${roleData.name}** - ${error.message}`);
                    }
                } else {
                    existingRoles++;
                    roleResults.push(`🔍 Already exists: **${roleData.name}**`);
                }
            }

            // Create summary embed
            const embed = new EmbedBuilder()
                .setTitle('🎭 Role Setup Complete')
                .setDescription(`Role setup has been completed for this server.\n\n${roleResults.join('\n')}`)
                .addFields(
                    { name: 'Summary', value: `• ${createdRoles} roles created\n• ${existingRoles} roles already existed`, inline: false },
                    { name: 'Role Functions', value: '• **Mod**: Admin permissions for game management\n• **Spectator**: Default role for new members\n• **Signed Up**: Players who joined the game\n• **Alive**: Players currently alive in-game\n• **Dead**: Players who have been eliminated', inline: false }
                )
                .setColor(0x00AE86);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error creating roles:', error);
            await message.reply('❌ An error occurred while setting up roles. Please check bot permissions.');
        }
    }

    async handleHelp(message) {
        const isAdmin = this.hasModeratorPermissions(message.member);
        
        const embed = new EmbedBuilder()
            .setTitle('🐺 Werewolf Bot Commands')
            .setDescription('Here are the available commands:')
            .setColor(0x3498DB);

        // Player commands (everyone can use) - grouped together
        embed.addFields(
            { 
                name: '👥 Player Commands', 
                value: '`Wolf.in` - Sign up for the current game\n' +
                       '`Wolf.out` - Remove yourself from the current game\n' +
                       '`Wolf.vote @user` - Vote for a player (voting booth, day phase only)\n' +
                       '`Wolf.retract` - Retract your current vote\n' +
                       '`Wolf.alive` - Show all players currently alive\n' +
                       '`Wolf.meme` - 😤 I dare you to try me\n' +
                       '`Wolf.help` - Show this help message', 
                inline: false 
            }
        );

        // Admin commands (only if user is admin) - grouped by category
        if (isAdmin) {
            embed.addFields(
                { 
                    name: '⚙️ Setup & Game Management', 
                    value: '`Wolf.setup` - Initial server setup (prefix, starting number, game name)\n' +
                           '`Wolf.server_roles` - 🎭 Create all game roles\n' +
                           '`Wolf.create` - Create a new game with signup channel\n' +
                           '`Wolf.start` - Start the game and create all channels\n' +
                           '`Wolf.settings` - View/change game and channel settings (votes_to_hang, messages)\n' +
                           '`Wolf.next` - Move to the next phase (day/night)\n' +
                           '`Wolf.end` - End the current game (requires confirmation)', 
                    inline: false 
                },
                { 
                    name: '🔧 Channel & Phase Management', 
                    value: '`Wolf.add_channel <n>` - Create additional channel in game category\n' +
                           '`Wolf.create_vote` - 🗳️ Manually create a voting message (voting booth only)', 
                    inline: false 
                },
                { 
                    name: '📔 Journal Management', 
                    value: '`Wolf.journal @user` - Create a personal journal for a player\n' +
                           '`Wolf.journal_link` - 🔗 Link existing journals to players\n' +
                           '`Wolf.journal_owner` - 👤 Show journal owner (use in journal)\n' +
                           '`Wolf.journal_unlink` - 🔓 Unlink journal (use in journal)\n' +
                           '`Wolf.journal_assign @user` - 🎯 Assign journal to user (use in journal)', 
                    inline: false 
                },
                { 
                    name: '🎭 Role & Player Management', 
                    value: '`Wolf.role_assign` - Randomly assign roles to signed-up players\n' +
                           '`Wolf.roles_list` - 📋 Display all assigned roles for current game', 
                    inline: false 
                },
                { 
                    name: '📊 Analysis & Utilities', 
                    value: '`Wolf.server` - 🖥️ Display detailed server information\n' +
                           '`Wolf.ia <YYYY-MM-DD HH:MM>` - Message count per player since date (EST)\n' +
                           '`Wolf.speed <number>` - ⚡ Start speed vote with reaction target', 
                    inline: false 
                },
                { 
                    name: '🔄 Recovery & Maintenance', 
                    value: '`Wolf.recovery` - Migration from manual to bot control\n' +
                           '`Wolf.issues` - 🐛 Display current known issues\n' +
                           '`Wolf.refresh` - Reset server (testing only!)', 
                    inline: false 
                }
            );
        } else {
            embed.setFooter({ text: 'Note: Some commands are only available to moderators.' });
        }

        await message.reply({ embeds: [embed] });
    }

    async handleAlive(message) {
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

        // Get all players in the game
        const allPlayers = await this.db.query(
            'SELECT user_id, username FROM players WHERE game_id = $1 ORDER BY username',
            [game.id]
        );

        if (allPlayers.rows.length === 0) {
            return message.reply('❌ No players found in the current game.');
        }

        // Filter alive players by checking Discord roles
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        if (!aliveRole) {
            return message.reply('❌ Alive role not found. Please use `Wolf.roles` to set up roles.');
        }

        const alivePlayers = [];
        for (const player of allPlayers.rows) {
            try {
                const member = await message.guild.members.fetch(player.user_id);
                if (member.roles.cache.has(aliveRole.id)) {
                    alivePlayers.push(player.username);
                }
            } catch (error) {
                // Player might have left the server, skip them
                console.log(`Could not fetch member ${player.user_id}, skipping`);
            }
        }

        if (alivePlayers.length === 0) {
            return message.reply('💀 No players are currently alive in the game.');
        }

        const playerList = alivePlayers.map((player, index) => `${index + 1}. ${player}`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle('💚 Alive Players')
            .setDescription(`Here are all the players currently alive in the game:`)
            .addFields({ 
                name: `Players (${alivePlayers.length})`, 
                value: playerList 
            })
            .setColor(0x00FF00);

        await message.reply({ embeds: [embed] });
    }

    async handleInList(message) {
        const serverId = message.guild.id;

        // Get active game in signup phase
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'signup']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game available for signups.');
        }

        const game = gameResult.rows[0];

        // Get all signed up players
        const playersResult = await this.db.query(
            'SELECT username FROM players WHERE game_id = $1 ORDER BY username',
            [game.id]
        );

        if (playersResult.rows.length === 0) {
            return message.reply('📝 No players have signed up yet.');
        }

        // Create a simple, mobile-friendly format
        const playerNames = playersResult.rows.map(p => p.username);
        const playerList = playerNames.join('\n');
        
        // Send as a code block for easy copying
        const response = `**📝 Signed Up Players (${playersResult.rows.length})**\n\`\`\`\n${playerList}\n\`\`\``;

        await message.reply(response);
    }

    async handleAddChannel(message, args) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3)',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        // Check if channel name is provided
        if (!args.length) {
            return message.reply('❌ Please provide a channel name. Usage: `Wolf.add_channel <channel-name>`');
        }

        const game = gameResult.rows[0];
        const channelName = args.join('-').toLowerCase();

        // Get roles
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');
        const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');

        // Get server config for prefix
        const configResult = await this.db.query(
            'SELECT * FROM server_configs WHERE server_id = $1',
            [serverId]
        );
        const config = configResult.rows[0];

        // Create the full channel name with prefix
        const fullChannelName = `${config.game_prefix}${game.game_number}-${channelName}`;

        try {
            // Create the channel in the game category with proper permissions
            const category = await this.client.channels.fetch(game.category_id);
            const newChannel = await message.guild.channels.create({
                name: fullChannelName,
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

            // Position the channel between voting booth and wolf chat
            try {
                // Find the wolf chat channel to position our new channel before it
                const wolfChatChannel = category.children.cache.find(channel => 
                    channel.name.includes('-wolf-chat')
                );
                
                if (wolfChatChannel) {
                    // Position the new channel just before wolf chat
                    await newChannel.setPosition(wolfChatChannel.position);
                    console.log(`Positioned new channel "${fullChannelName}" before wolf chat`);
                }
            } catch (positionError) {
                console.error('Error positioning new channel:', positionError);
                // Continue even if positioning fails - channel is still created
            }

            // Permissions are set during channel creation

            // Save channel to database with default day/night messages from the game
            await this.db.query(
                'INSERT INTO game_channels (game_id, channel_id, channel_name, day_message, night_message) VALUES ($1, $2, $3, $4, $5)',
                [game.id, newChannel.id, fullChannelName, game.day_message, game.night_message]
            );

            const embed = new EmbedBuilder()
                .setTitle('📁 Channel Created')
                .setDescription(`Successfully created new game channel!`)
                .addFields(
                    { name: 'Channel', value: `<#${newChannel.id}>`, inline: true },
                    { name: 'Name', value: fullChannelName, inline: true }
                )
                .setColor(0x00AE86);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error creating channel:', error);
            await message.reply('❌ An error occurred while creating the channel.');
        }
    }

    async handleIssues(message) {
        const embed = new EmbedBuilder()
            .setTitle('🐛 Issues and Bugs')
            .setDescription(fs.readFileSync('./ISSUE_TRACKING.md', 'utf-8'))

        await message.reply({ embeds: [embed] });
    }

    async handleRecovery(message) {
        const serverId = message.guild.id;
        
        try {
            // Step 1: Check if setup was done
            const embed1 = new EmbedBuilder()
                .setTitle('🔧 Recovery Mode - Server Setup Check')
                .setDescription('Recovery mode will help you migrate from manual game management back to the bot.\n\n**Important:** Have you already run `Wolf.setup` to configure this server?')
                .addFields(
                    { name: 'Required', value: 'You must have run `Wolf.setup` first before using recovery mode.', inline: false },
                    { name: 'Response', value: 'Type `yes` if you have run setup, or `cancel` to exit and run setup first.', inline: false }
                )
                .setColor(0xF39C12);

            await message.reply({ embeds: [embed1] });

            const setupResponse = await this.awaitResponse(message, ['yes', 'cancel'], 60000);
            if (!setupResponse || setupResponse === 'cancel') {
                return message.reply('❌ Recovery cancelled. Please run `Wolf.setup` first, then try recovery again.');
            }

            // Verify setup exists in database
            const configResult = await this.db.query(
                'SELECT * FROM server_configs WHERE server_id = $1',
                [serverId]
            );

            if (!configResult.rows.length) {
                return message.reply('❌ No server configuration found. Please run `Wolf.setup` first.');
            }

            const config = configResult.rows[0];

            // Step 2: Ask for game category
            const embed2 = new EmbedBuilder()
                .setTitle('🎮 Recovery Mode - Game Category')
                .setDescription('What is the name of the current game\'s category?\n\nPlease type the exact name of the category channel.')
                .setColor(0x3498DB);

            await message.reply({ embeds: [embed2] });

            const categoryName = await this.awaitTextResponse(message, 60000);
            if (!categoryName) {
                return message.reply('❌ Recovery timed out. Please try again.');
            }

            // Find the category
            const category = message.guild.channels.cache.find(c => 
                c.type === ChannelType.GuildCategory && 
                c.name.toLowerCase() === categoryName.toLowerCase()
            );

            if (!category) {
                return message.reply(`❌ Could not find category "${categoryName}". Please check the name and try again.`);
            }

            // Step 3: Ask about game status
            const embed3 = new EmbedBuilder()
                .setTitle('📊 Recovery Mode - Game Status')
                .setDescription('What is the current status of the game?')
                .addFields(
                    { name: 'Options', value: '• Type `signup` if the game is still in signups\n• Type `active` if the game has started', inline: false }
                )
                .setColor(0x9B59B6);

            await message.reply({ embeds: [embed3] });

            const gameStatus = await this.awaitResponse(message, ['signup', 'active'], 60000);
            if (!gameStatus) {
                return message.reply('❌ Recovery timed out. Please try again.');
            }

            // Step 4: Find players and confirm
            let players = [];
            if (gameStatus === 'signup') {
                const signedUpRole = message.guild.roles.cache.find(r => r.name === 'Signed Up');
                if (signedUpRole) {
                    // Ensure we have all members cached
                    await message.guild.members.fetch();
                    players = signedUpRole.members.map(member => ({
                        user_id: member.id,
                        username: member.displayName,
                        status: 'alive'
                    }));
                }
            } else {
                // Ensure we have all members cached before checking roles
                await message.guild.members.fetch();
                
                const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
                const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');

                console.log(aliveRole.members)
                
                if (aliveRole) {
                    aliveRole.members.forEach(member => {
                        players.push({
                            user_id: member.id,
                            username: member.displayName,
                            status: 'alive'
                        });
                    });
                }
                
                if (deadRole) {
                    deadRole.members.forEach(member => {
                        players.push({
                            user_id: member.id,
                            username: member.displayName,
                            status: 'dead'
                        });
                    });
                }
            }

            if (players.length === 0) {
                return message.reply('❌ No players found with the appropriate roles. Please assign roles first.');
            }

            const playerList = players.map((p, i) => 
                `${i + 1}. ${p.username} ${gameStatus === 'active' ? `(${p.status})` : ''}`
            ).join('\n');

            const embed4 = new EmbedBuilder()
                .setTitle('👥 Recovery Mode - Player Confirmation')
                .setDescription('Here are the players found in the game:')
                .addFields({ name: `Players (${players.length})`, value: playerList })
                .setFooter({ text: 'Type "yes" to confirm or "no" to cancel' })
                .setColor(0x00AE86);

            await message.reply({ embeds: [embed4] });

            const playerConfirm = await this.awaitResponse(message, ['yes', 'no'], 60000);
            if (!playerConfirm || playerConfirm === 'no') {
                return message.reply('❌ Recovery cancelled. Please adjust player roles and try again.');
            }

            // Step 5: If game is active, ask about day/night and day number
            let dayPhase = 'night';
            let dayNumber = 1;
            
            if (gameStatus === 'active') {
                const embed5a = new EmbedBuilder()
                    .setTitle('🌙🌞 Recovery Mode - Game Phase')
                    .setDescription('What phase is the game currently in?')
                    .addFields(
                        { name: 'Options', value: '• Type `day` if it\'s currently day time\n• Type `night` if it\'s currently night time', inline: false }
                    )
                    .setColor(0xF1C40F);

                await message.reply({ embeds: [embed5a] });

                dayPhase = await this.awaitResponse(message, ['day', 'night'], 60000);
                if (!dayPhase) {
                    return message.reply('❌ Recovery timed out. Please try again.');
                }

                const embed5b = new EmbedBuilder()
                    .setTitle('📅 Recovery Mode - Day Number')
                    .setDescription('What day number is the game currently on?\n\nPlease type a number (e.g., 1, 2, 3...)')
                    .setColor(0xE67E22);

                await message.reply({ embeds: [embed5b] });

                const dayNumberStr = await this.awaitTextResponse(message, 60000);
                if (!dayNumberStr) {
                    return message.reply('❌ Recovery timed out. Please try again.');
                }

                dayNumber = parseInt(dayNumberStr);
                if (isNaN(dayNumber) || dayNumber < 1) {
                    return message.reply('❌ Invalid day number. Please try again with a valid number.');
                }
            }

            // Step 6: Ask for channel names
            const channels = {};
            
            if (gameStatus === 'signup') {
                // Only ask for signup channel
                const embed6 = new EmbedBuilder()
                    .setTitle('📺 Recovery Mode - Signup Channel')
                    .setDescription('What is the name of the signup channel?\n\nPlease type the exact channel name (without #).')
                    .setColor(0x8E44AD);

                await message.reply({ embeds: [embed6] });

                const signupChannelName = await this.awaitTextResponse(message, 60000);
                if (!signupChannelName) {
                    return message.reply('❌ Recovery timed out. Please try again.');
                }

                const signupChannel = message.guild.channels.cache.find(c => 
                    c.name.toLowerCase() === signupChannelName.toLowerCase() && 
                    c.parent?.id === category.id
                );

                if (!signupChannel) {
                    return message.reply(`❌ Could not find channel "${signupChannelName}" in the game category.`);
                }

                channels.signup_channel_id = signupChannel.id;
            } else {
                // Ask for all game channels
                const coreChannels = [
                    { key: 'town_square_channel_id', name: 'Town Square', description: 'the main discussion channel' },
                    { key: 'voting_booth_channel_id', name: 'Voting Booth', description: 'where players exercise their right to hang innocents' },
                    { key: 'wolf_chat_channel_id', name: 'Wolf Chat', description: 'the liars den' },
                    { key: 'memos_channel_id', name: 'Memos', description: 'the memos/notes channel' },
                    { key: 'results_channel_id', name: 'Results', description: 'where mods ruin people\'s day' },
                    { key: 'signup_channel_id', name: 'Dead Chat', description: 'the losers chat' }
                ];

                for (const channelInfo of coreChannels) {
                    const embed6 = new EmbedBuilder()
                        .setTitle(`📺 Recovery Mode - ${channelInfo.name}`)
                        .setDescription(`What is the name of ${channelInfo.description}?\n\nPlease type the exact channel name (without #).`)
                        .setColor(0x8E44AD);

                    await message.reply({ embeds: [embed6] });

                    const channelName = await this.awaitTextResponse(message, 60000);
                    if (!channelName) {
                        return message.reply('❌ Recovery timed out. Please try again.');
                    }

                    const channel = message.guild.channels.cache.find(c => 
                        c.name.toLowerCase() === channelName.toLowerCase() && 
                        c.parent?.id === category.id
                    );

                    if (!channel) {
                        return message.reply(`❌ Could not find channel "${channelName}" in the game category.`);
                    }

                    channels[channelInfo.key] = channel.id;
                }

                // Ask for additional channels
                const additionalChannels = [];
                while (true) {
                    const embedExtra = new EmbedBuilder()
                        .setTitle('➕ Recovery Mode - Additional Channels')
                        .setDescription('Are there any additional custom channels in the game category?\n\nType the channel name (without #) to add it, or type `done` when finished.')
                        .setColor(0x95A5A6);

                    await message.reply({ embeds: [embedExtra] });

                    const extraChannelName = await this.awaitTextResponse(message, 60000);
                    if (!extraChannelName || extraChannelName.toLowerCase() === 'done') {
                        break;
                    }

                    const extraChannel = message.guild.channels.cache.find(c => 
                        c.name.toLowerCase() === extraChannelName.toLowerCase() && 
                        c.parent?.id === category.id
                    );

                    if (!extraChannel) {
                        await message.reply(`❌ Could not find channel "${extraChannelName}" in the game category. Skipping...`);
                        continue;
                    }

                    additionalChannels.push({
                        channel_id: extraChannel.id,
                        channel_name: extraChannel.name
                    });

                    await message.reply(`✅ Added "${extraChannel.name}" to additional channels.`);
                }

                channels.additionalChannels = additionalChannels;
            }

            // Step 7: Show summary and confirm
            const summaryEmbed = new EmbedBuilder()
                .setTitle('📋 Recovery Mode - Final Confirmation')
                .setDescription('Please review all the information before we save it to the database:')
                .addFields(
                    { name: 'Game Category', value: category.name, inline: true },
                    { name: 'Game Status', value: gameStatus === 'signup' ? 'Signups' : 'Active', inline: true },
                    { name: 'Players', value: `${players.length} players found`, inline: true }
                );

            if (gameStatus === 'active') {
                summaryEmbed.addFields(
                    { name: 'Current Phase', value: `${dayPhase} ${dayNumber}`, inline: true }
                );
            }

            // Add channel information
            let channelInfo = '';
            if (gameStatus === 'signup') {
                const signupChannel = message.guild.channels.cache.get(channels.signup_channel_id);
                channelInfo = `• Signup: ${signupChannel.name}`;
            } else {
                const channelNames = Object.entries(channels)
                    .filter(([key]) => key !== 'additionalChannels')
                    .map(([key, channelId]) => {
                        const channel = message.guild.channels.cache.get(channelId);
                        const displayName = key.replace('_channel_id', '').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                        return `• ${displayName}: ${channel.name}`;
                    }).join('\n');

                if (channels.additionalChannels && channels.additionalChannels.length > 0) {
                    channelInfo += '\n• Additional: ' + channels.additionalChannels.map(c => c.channel_name).join(', ');
                }
            }

            summaryEmbed.addFields({ name: 'Channels', value: channelInfo, inline: false });
            summaryEmbed.setFooter({ text: 'Type "confirm" to save this data or "cancel" to abort' });
            summaryEmbed.setColor(0x2ECC71);

            await message.reply({ embeds: [summaryEmbed] });

            const finalConfirm = await this.awaitResponse(message, ['confirm', 'cancel'], 60000);
            if (!finalConfirm || finalConfirm === 'cancel') {
                return message.reply('❌ Recovery cancelled. No data was saved.');
            }

            // Step 8: Save to database
            const gameId = await this.saveRecoveryData(serverId, config, {
                category_id: category.id,
                game_status: gameStatus,
                day_phase: dayPhase,
                day_number: dayNumber,
                players: players,
                channels: channels
            });

            // If game is active and it's day time, create voting message
            if (gameStatus === 'active' && dayPhase === 'day' && channels.voting_booth_channel_id) {
                try {
                    const votingChannel = await this.client.channels.fetch(channels.voting_booth_channel_id);
                    await this.createVotingMessage(gameId, votingChannel);
                } catch (error) {
                    console.error('Error creating voting message during recovery:', error);
                }
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Recovery Complete!')
                .setDescription('All data has been successfully saved to the database. The bot is now ready to manage your game.')
                .addFields(
                    { name: 'What\'s Next?', value: '• The bot will now track your game state\n• You can use normal bot commands\n• Game data is synchronized with Discord roles' + (gameStatus === 'active' && dayPhase === 'day' ? '\n• Voting message has been posted to the voting booth' : ''), inline: false }
                )
                .setColor(0x00AE86);

            await message.reply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error in recovery mode:', error);
            await message.reply('❌ An error occurred during recovery. Please try again.');
        }
    }

    async awaitResponse(message, validResponses, timeout = 30000) {
        const filter = (m) => m.author.id === message.author.id && 
                             validResponses.includes(m.content.toLowerCase());
        
        try {
            const collected = await message.channel.awaitMessages({ 
                filter, 
                max: 1, 
                time: timeout,
                errors: ['time']
            });
            return collected.first().content.toLowerCase();
        } catch (error) {
            return null;
        }
    }

    async awaitTextResponse(message, timeout = 30000) {
        const filter = (m) => m.author.id === message.author.id && !m.author.bot;
        
        try {
            const collected = await message.channel.awaitMessages({ 
                filter, 
                max: 1, 
                time: timeout,
                errors: ['time']
            });
            return collected.first().content.trim();
        } catch (error) {
            return null;
        }
    }

    async saveRecoveryData(serverId, config, recoveryData) {
        try {
            // First, check if there's already an active game and end it
            await this.db.query(
                'UPDATE games SET status = $1 WHERE server_id = $2 AND status IN ($3, $4)',
                ['ended', serverId, 'signup', 'active']
            );

            // Create new game entry
            const gameResult = await this.db.query(
                `INSERT INTO games (
                    server_id, game_number, game_name, category_id, status, day_phase, day_number,
                    signup_channel_id, town_square_channel_id, wolf_chat_channel_id, 
                    memos_channel_id, results_channel_id, voting_booth_channel_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
                RETURNING id`,
                [
                    serverId,
                    config.game_counter - 1, // Use current counter minus 1 since it was already incremented
                    config.game_name,
                    recoveryData.category_id,
                    recoveryData.game_status,
                    recoveryData.day_phase,
                    recoveryData.day_number,
                    recoveryData.channels.signup_channel_id || null,
                    recoveryData.channels.town_square_channel_id || null,
                    recoveryData.channels.wolf_chat_channel_id || null,
                    recoveryData.channels.memos_channel_id || null,
                    recoveryData.channels.results_channel_id || null,
                    recoveryData.channels.voting_booth_channel_id || null
                ]
            );

            const gameId = gameResult.rows[0].id;

            // Insert players
            for (const player of recoveryData.players) {
                await this.db.query(
                    'INSERT INTO players (game_id, user_id, username, status) VALUES ($1, $2, $3, $4)',
                    [gameId, player.user_id, player.username, player.status]
                );
            }

            // Insert additional channels if any
            if (recoveryData.channels.additionalChannels) {
                for (const channel of recoveryData.channels.additionalChannels) {
                    await this.db.query(
                        'INSERT INTO game_channels (game_id, channel_id, channel_name) VALUES ($1, $2, $3)',
                        [gameId, channel.channel_id, channel.channel_name]
                    );
                }
            }

            console.log(`Recovery completed for server ${serverId}, game ID ${gameId}`);
            return gameId; // Return the game ID
        } catch (error) {
            console.error('Error saving recovery data:', error);
            throw error;
        }
    }

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
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

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

                // Position it under the current game but above other games
                try {
                    const currentGameCategory = await this.client.channels.fetch(game.category_id);
                    if (currentGameCategory) {
                        const targetPosition = currentGameCategory.position + 1;
                        await journalsCategory.setPosition(targetPosition);
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
                channel => channel.name === journalChannelName && channel.parent?.id === journalsCategory.id
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
                parent: journalsCategory.id,
                permissionOverwrites: [
                    {
                        id: message.guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: targetUser.id,
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
                .setDescription(`Welcome to your personal journal, ${targetMember.displayName}!\n\nThis is your private space to:\n• Take notes during the game\n• Ask questions to the moderators\n• Record your thoughts and observations\n\n**Permissions:**\n• **You** can read and write\n• **Moderators** can read and write\n• **Spectators** can read only`)
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

        } catch (error) {
            console.error('Error creating journal:', error);
            await message.reply('❌ An error occurred while creating the journal.');
        }
    }

    async handleIA(message, args) {
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

        // Check if date/time argument is provided
        let argumentsArray = args
        if (!argumentsArray.length) {
            // Use current date in EST/EDT timezone instead of UTC to avoid next-day issues
            const now = moment.tz("America/New_York");
            const cutoffTime = moment.tz("America/New_York").hour(9).minute(30).second(0).millisecond(0);
            
            // If it's before 9:30 AM EST today, search from 9:30 AM yesterday
            let searchDate;
            if (now.isBefore(cutoffTime)) {
                searchDate = now.subtract(1, 'day').format('YYYY-MM-DD');
            } else {
                searchDate = now.format('YYYY-MM-DD');
            }
            
            argumentsArray = [searchDate, '09:30'];
        }

        // Parse the date/time argument
        const dateTimeStr = argumentsArray.join(' ');
        let utcDate;
        
        try {
            // Parse the input date assuming it's in EST/EDT
            // We need to explicitly specify the timezone to ensure proper conversion
            utcDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm", "America/New_York")
               .utc()
               .toDate();

            // Check if the date is valid
            if (isNaN(utcDate.getTime())) {
                throw new Error('Invalid date');
            }
        } catch (error) {
            return message.reply('❌ Invalid date format. Please use: `Wolf.ia YYYY-MM-DD HH:MM` (24-hour format, EST timezone)\nExample: `Wolf.ia 2024-12-01 14:30`');
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
                return message.reply('❌ Alive role not found. Please use `Wolf.roles` to set up roles.');
            }

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

            // Fetch messages from the town square since the specified date
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
                    msg.createdAt >= utcDate && 
                    !msg.author.bot && 
                    messageCounts.hasOwnProperty(msg.author.id)
                );

                allMessages.push(...filteredMessages.values());
                
                // Check if we've gone past our date range
                const oldestMessage = messages.last();
                if (oldestMessage.createdAt < utcDate) {
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

            // Create the response embed
            const totalMessages = allMessages.length;
            const playerList = sortedPlayers.length > 0 
                ? sortedPlayers.map((player, index) => 
                    `${index + 1}. **${player.username}**: ${player.count} messages`
                ).join('\n')
                : 'No messages found from players in the specified time period.';

            const embed = new EmbedBuilder()
                .setTitle('📊 Town Square Activity Report')
                .setDescription(`Message count per player since **${dateTimeStr} EST**`)
                .addFields(
                    { name: `Player Activity (${sortedPlayers.length} players)`, value: playerList },
                    { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${townSquareChannel.name}`, inline: false }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching message activity:', error);
            await message.reply('❌ An error occurred while fetching message activity. The date range might be too large or the channel might be inaccessible.');
        }
    }

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
                return message.reply('❌ Alive role not found. Please use `Wolf.roles` to set up roles.');
            }

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

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching speed check activity:', error);
            await message.reply('❌ An error occurred while fetching speed check activity.');
        }
    }

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
            return message.reply('❌ Please provide a valid speed target number. Usage: `Wolf.speed <number>` or `Wolf.speed abort`');
        }

        const speedTarget = parseInt(args[0]);

        if (speedTarget < 1) {
            return message.reply('❌ Speed target must be at least 1.');
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
                return message.reply('❌ Alive role not found. Please use `Wolf.roles` to set up roles.');
            }

            // Get the results channel
            const resultsChannel = await this.client.channels.fetch(game.results_channel_id);
            if (!resultsChannel) {
                return message.reply('❌ Results channel not found.');
            }

            // Create the speed vote embed
            const embed = new EmbedBuilder()
                .setTitle('⚡ Speed Vote!')
                .setDescription(`Bunch of impatient players want to speed up the game! React with ⚡ if you agree!`)
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

            // Add the lightning bolt reaction
            await speedMessage.react('⚡');

            // Store the speed vote in the database
            await this.db.query(
                'INSERT INTO game_speed (game_id, message_id, channel_id, target_reactions, current_reactions) VALUES ($1, $2, $3, $4, $5)',
                [game.id, speedMessage.id, resultsChannel.id, speedTarget, 0]
            );

            console.log(`Speed vote created: target=${speedTarget}, message_id=${speedMessage.id}, channel=${resultsChannel.name}`);

            // Reply to the mod who initiated the command
            await message.reply(`✅ Speed vote created in ${resultsChannel}! Target: ${speedTarget} reactions.`);

            // Set up reaction event listener
            this.setupSpeedReactionListener(speedMessage, game, speedTarget);

        } catch (error) {
            console.error('Error creating speed vote:', error);
            await message.reply('❌ An error occurred while creating the speed vote.');
        }
    }

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
    }

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

                // Fetch the latest message to get current reactions
                const channel = await this.client.channels.fetch(speedMessage.channel.id);
                const message = await channel.messages.fetch(speedMessage.id);
                
                // Find the lightning bolt reaction
                const lightningReaction = message.reactions.cache.get('⚡');
                
                if (lightningReaction) {
                    // Count non-bot reactions
                    const users = await lightningReaction.users.fetch();
                    const currentReactions = users.filter(user => !user.bot).size;
                    
                    // Get the stored reaction count from database
                    const storedCount = speedCheck.rows[0].current_reactions;
                    
                    // Only update if the count has changed
                    if (currentReactions !== storedCount) {
                        console.log(`Speed vote reaction count changed: ${storedCount} -> ${currentReactions}`);
                        await this.updateSpeedVote(speedMessage, game, speedTarget, currentReactions);
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

    async updateSpeedVote(speedMessage, game, speedTarget, currentReactions) {
        try {
            // Update database
            await this.db.query(
                'UPDATE game_speed SET current_reactions = $1 WHERE game_id = $2',
                [currentReactions, game.id]
            );

            // Update the embed
            const embed = new EmbedBuilder()
                .setTitle('⚡ Speed Vote!')
                .setDescription(`Bunch of impatient players want to speed up the game! React with ⚡ if you agree!`)
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
    }

    async completeSpeedVote(game, speedMessage) {
        try {
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
    }

    async handleReaction(reaction, user) {
        try {
            // Only handle lightning bolt reactions
            if (reaction.emoji.name !== '⚡') return;

            // Check if this is a speed vote message
            const speedVote = await this.db.query(
                'SELECT * FROM game_speed WHERE message_id = $1',
                [reaction.message.id]
            );

            if (speedVote.rows.length === 0) return;

            // Remove the bot's initial reaction to keep the count clean
            // The bot's reaction doesn't count toward the target but helps users react
            await reaction.users.remove(this.client.user.id);
            
            console.log(`Removed bot reaction from speed vote message ${reaction.message.id} after ${user.tag} reacted`);

        } catch (error) {
            console.error('Error handling reaction:', error);
        }
    }

    async handleSettings(message, args) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3)',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // If no arguments provided, display current settings (anyone can view)
        if (args.length === 0) {
            // Get additional channels for this game
            const channelsResult = await this.db.query(
                'SELECT channel_name, day_message, night_message FROM game_channels WHERE game_id = $1 ORDER BY channel_name',
                [game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Game Settings')
                .setDescription('Current game settings for this server:')
                .addFields(
                    { name: 'Votes to Hang', value: `${game.votes_to_hang}\n*To change: \`Wolf.settings votes_to_hang 3\`*`, inline: false },
                    { name: 'Default Day Message', value: `${game.day_message}\n*To change: \`Wolf.settings day_message Your message here\`*`, inline: false },
                    { name: 'Default Night Message', value: `${game.night_message}\n*To change: \`Wolf.settings night_message Your message here\`*`, inline: false },
                    { name: 'Wolf Day Message', value: `${game.wolf_day_message || 'Not set'}\n*To change: \`Wolf.settings wolf day_message Your message here\`*`, inline: false },
                    { name: 'Wolf Night Message', value: `${game.wolf_night_message || 'Not set'}\n*To change: \`Wolf.settings wolf night_message Your message here\`*`, inline: false }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            // Add channel-specific messages if any exist
            if (channelsResult.rows.length > 0) {
                let channelInfo = '';
                for (const channel of channelsResult.rows) {
                    const shortName = channel.channel_name.split('-').slice(-1)[0]; // Get the last part after the last dash
                    channelInfo += `**${shortName}:**\n`;
                    channelInfo += `Day: ${channel.day_message || 'Using default'}\n`;
                    channelInfo += `Night: ${channel.night_message || 'Using default'}\n`;
                    channelInfo += `*To change: \`Wolf.settings ${shortName} day_message/night_message Your message\`*\n\n`;
                }
                
                embed.addFields({ 
                    name: 'Channel-Specific Messages', 
                    value: channelInfo.trim(),
                    inline: false 
                });
            }

            return message.reply({ embeds: [embed] });
        }

        // Check permissions for changing settings (moderators only)
        if (!this.hasModeratorPermissions(message.member)) {
            return message.reply('❌ You need moderator permissions to change game settings.');
        }

        // Handle setting changes
        const firstArg = args[0].toLowerCase();

        // Check if this is a wolf-specific setting (format: wolf day_message|night_message <message>)
        if (firstArg === 'wolf' && args.length >= 3) {
            const settingType = args[1].toLowerCase();
            
            if (settingType === 'day_message') {
                const newMessage = args.slice(2).join(' ');

                // Update the wolf day message
                await this.db.query(
                    'UPDATE games SET wolf_day_message = $1 WHERE id = $2',
                    [newMessage, game.id]
                );

                const embed = new EmbedBuilder()
                    .setTitle('🐺🌅 Wolf Day Message Updated')
                    .setDescription('✅ **Wolf Day Message** has been updated!')
                    .addFields(
                        { name: 'New Wolf Day Message', value: newMessage, inline: false }
                    )
                    .setColor(0xF1C40F)
                    .setTimestamp();

                return message.reply({ embeds: [embed] });

            } else if (settingType === 'night_message') {
                const newMessage = args.slice(2).join(' ');

                // Update the wolf night message
                await this.db.query(
                    'UPDATE games SET wolf_night_message = $1 WHERE id = $2',
                    [newMessage, game.id]
                );

                const embed = new EmbedBuilder()
                    .setTitle('🐺🌙 Wolf Night Message Updated')
                    .setDescription('✅ **Wolf Night Message** has been updated!')
                    .addFields(
                        { name: 'New Wolf Night Message', value: newMessage, inline: false }
                    )
                    .setColor(0x2C3E50)
                    .setTimestamp();

                return message.reply({ embeds: [embed] });

            } else {
                return message.reply('❌ Wolf message type must be `day_message` or `night_message`. Example: `Wolf.settings wolf day_message Your message here`');
            }
        }

        // Check if this is a channel-specific setting (format: <channel_name> day_message|night_message <message>)
        if (args.length >= 3) {
            const channelName = firstArg;
            const settingType = args[1].toLowerCase();
            
            if (settingType === 'day_message' || settingType === 'night_message') {
                // Find the channel in the database
                const channelResult = await this.db.query(
                    'SELECT * FROM game_channels WHERE game_id = $1 AND (channel_name LIKE $2 OR channel_name LIKE $3)',
                    [game.id, `%${channelName}`, `%${channelName}%`]
                );

                if (!channelResult.rows.length) {
                    return message.reply(`❌ Channel "${channelName}" not found. Make sure you use the short channel name (e.g., "memes" for "g1-memes").`);
                }

                const channel = channelResult.rows[0];
                const newMessage = args.slice(2).join(' ');

                // Update the channel's message
                const columnName = settingType;
                await this.db.query(
                    `UPDATE game_channels SET ${columnName} = $1 WHERE id = $2`,
                    [newMessage, channel.id]
                );

                const shortName = channel.channel_name.split('-').slice(-1)[0];
                const messageType = settingType === 'day_message' ? 'Day' : 'Night';
                const emoji = settingType === 'day_message' ? '🌅' : '🌙';

                const embed = new EmbedBuilder()
                    .setTitle(`${emoji} Channel ${messageType} Message Updated`)
                    .setDescription(`✅ **${shortName}** ${messageType.toLowerCase()} message has been updated!`)
                    .addFields(
                        { name: `New ${messageType} Message`, value: newMessage, inline: false }
                    )
                    .setColor(settingType === 'day_message' ? 0xF1C40F : 0x2C3E50)
                    .setTimestamp();

                return message.reply({ embeds: [embed] });
            }
        }

        // Handle global game settings
        if (firstArg === 'votes_to_hang') {
            const value = args[1];
            if (!value) {
                return message.reply('❌ Please provide a value for votes_to_hang. Example: `Wolf.settings votes_to_hang 3`');
            }

            const newValue = parseInt(value);
            if (isNaN(newValue) || newValue < 1 || newValue > 20) {
                return message.reply('❌ Votes to hang must be a number between 1 and 20.');
            }

            // Update the game setting
            await this.db.query(
                'UPDATE games SET votes_to_hang = $1 WHERE id = $2',
                [newValue, game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Setting Updated')
                .setDescription(`✅ **Votes to Hang** has been updated to **${newValue}**`)
                .setColor(0x27AE60)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            // Update voting message if it exists
            await this.updateVotingMessage({ ...game, votes_to_hang: newValue });

        } else if (firstArg === 'day_message') {
            if (args.length < 2) {
                return message.reply('❌ Please provide a day message. Example: `Wolf.settings day_message WAKE UP! Time to vote!`');
            }

            const newMessage = args.slice(1).join(' ');

            // Update the default day message
            await this.db.query(
                'UPDATE games SET day_message = $1 WHERE id = $2',
                [newMessage, game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('🌅 Default Day Message Updated')
                .setDescription('✅ **Default Day Message** has been updated!')
                .addFields(
                    { name: 'New Day Message', value: newMessage, inline: false }
                )
                .setColor(0xF1C40F)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } else if (firstArg === 'night_message') {
            if (args.length < 2) {
                return message.reply('❌ Please provide a night message. Example: `Wolf.settings night_message Night falls. Someone is snoring really loudly.`');
            }

            const newMessage = args.slice(1).join(' ');

            // Update the default night message
            await this.db.query(
                'UPDATE games SET night_message = $1 WHERE id = $2',
                [newMessage, game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('🌙 Default Night Message Updated')
                .setDescription('✅ **Default Night Message** has been updated!')
                .addFields(
                    { name: 'New Night Message', value: newMessage, inline: false }
                )
                .setColor(0x2C3E50)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } else {
            return message.reply('❌ Unknown setting. Available settings:\n• `votes_to_hang`\n• `day_message`, `night_message` (default messages)\n• `wolf day_message`, `wolf night_message` (wolf chat specific)\n• `<channel_name> day_message`, `<channel_name> night_message` (channel-specific)');
        }
    }

    async handleRoleAssign(message, args) {
        const serverId = message.guild.id;

        // Get active game in signup or active phase
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3) ORDER BY id DESC LIMIT 1',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Get all players in the game
        const playersResult = await this.db.query(
            'SELECT user_id, username FROM players WHERE game_id = $1 ORDER BY username',
            [game.id]
        );

        if (playersResult.rows.length === 0) {
            return message.reply('❌ No players found in the current game.');
        }

        // Check if roles were provided in the command
        if (args.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('🎭 Role Assignment')
                .setDescription('Please provide a list of roles to assign. Roles should be organized in three blocks separated by blank lines.')
                .addFields(
                    { name: 'Format', value: '```Villager\nSeer\nDoctor\n\nWerewolf\nWerewolf\n\nTanner\nJester```', inline: false },
                    { name: 'Blocks', value: '• **First block**: Village roles\n• **Second block**: Wolf roles\n• **Third block**: Neutral roles', inline: false },
                    { name: 'Current Players', value: playersResult.rows.map((p, i) => `${i + 1}. ${p.username}`).join('\n'), inline: false },
                    { name: 'Player Count', value: `${playersResult.rows.length} players signed up`, inline: true }
                )
                .setColor(0x9B59B6)
                .setFooter({ text: 'Please respond with your role list in the format above' });

            await message.reply({ embeds: [embed] });

            // Wait for the role list
            const filter = (m) => m.author.id === message.author.id && !m.author.bot;
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 120000 });

            if (!collected.size) {
                return message.reply('⏰ Role assignment timed out. Please try again.');
            }

            const roleText = collected.first().content.trim();
            return this.parseAndAssignRoles(message, game, playersResult.rows, roleText);
        } else {
            // Roles provided directly in the command
            const roleText = args.join(' ');
            return this.parseAndAssignRoles(message, game, playersResult.rows, roleText);
        }
    }

    async parseAndAssignRoles(message, game, players, roleText) {
        try {
            // Split by double newlines to get the three blocks
            const blocks = roleText.split(/\n\s*\n/).map(block => block.trim()).filter(block => block.length > 0);
            
            if (blocks.length !== 3) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Invalid Format')
                    .setDescription('Please provide exactly three blocks of roles separated by blank lines.')
                    .addFields(
                        { name: 'Expected Format', value: '```Village roles\n\nWolf roles\n\nNeutral roles```', inline: false },
                        { name: 'Your Input', value: `Found ${blocks.length} blocks, expected 3`, inline: false }
                    )
                    .setColor(0xE74C3C);

                return message.reply({ embeds: [embed] });
            }

            // Parse each block
            const villageRoles = blocks[0].split('\n').map(role => role.trim()).filter(role => role.length > 0);
            const wolfRoles = blocks[1].split('\n').map(role => role.trim()).filter(role => role.length > 0);
            const neutralRoles = blocks[2].split('\n').map(role => role.trim()).filter(role => role.length > 0);

            // Combine all roles with their categories
            const allRoles = [
                ...villageRoles.map(role => ({ role, isWolf: false, category: 'Village' })),
                ...wolfRoles.map(role => ({ role, isWolf: true, category: 'Wolf' })),
                ...neutralRoles.map(role => ({ role, isWolf: false, category: 'Neutral' }))
            ];

            return this.assignRoles(message, game, players, allRoles);
        } catch (error) {
            console.error('Error parsing roles:', error);
            await message.reply('❌ An error occurred while parsing the roles. Please check your format and try again.');
        }
    }

    async assignRoles(message, game, players, roleData) {
        try {
            // Validate role count with special testing exception
            const isTestingMode = roleData.length === 3 && players.length === 1;
            
            if (roleData.length !== players.length && !isTestingMode) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Role Count Mismatch')
                    .setDescription(`The number of roles (${roleData.length}) does not match the number of players (${players.length}).`)
                    .addFields(
                        { name: 'Players', value: `${players.length} players`, inline: true },
                        { name: 'Roles', value: `${roleData.length} roles`, inline: true },
                        { name: 'Role Breakdown', value: this.getRoleBreakdown(roleData), inline: false }
                    )
                    .setColor(0xE74C3C);

                return message.reply({ embeds: [embed] });
            }

            // If in testing mode, only assign the first role to the single player
            const effectiveRoleData = isTestingMode ? [roleData[0]] : roleData;

            // Create a copy of players array for shuffling (preserve role order)
            const shuffledPlayers = [...players];

            // Shuffle only the players array using Fisher-Yates algorithm
            for (let i = shuffledPlayers.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
            }

            // Create role assignments (roles maintain their original order)
            const assignments = [];
            for (let i = 0; i < shuffledPlayers.length; i++) {
                assignments.push({
                    player: shuffledPlayers[i].username,
                    role: effectiveRoleData[i].role,
                    isWolf: effectiveRoleData[i].isWolf,
                    category: effectiveRoleData[i].category,
                    userId: shuffledPlayers[i].user_id,
                    roleIndex: i
                });
            }

            // Save role assignments to database
            for (const assignment of assignments) {
                await this.db.query(
                    'UPDATE players SET role = $1, is_wolf = $2 WHERE game_id = $3 AND user_id = $4',
                    [assignment.role, assignment.isWolf, game.id, assignment.userId]
                );
            }

            // Create the assignment list organized by category
            const villageAssignments = assignments.filter(a => a.category === 'Village');
            const wolfAssignments = assignments.filter(a => a.category === 'Wolf');
            const neutralAssignments = assignments.filter(a => a.category === 'Neutral');

            let assignmentText = '';
            
            if (villageAssignments.length > 0) {
                assignmentText += '**🏘️ Town:**\n';
                assignmentText += villageAssignments.map(a => `• **${a.role}** - ${a.player}`).join('\n');
            }
            
            if (wolfAssignments.length > 0) {
                if (assignmentText) assignmentText += '\n\n';
                assignmentText += '**🐺 Wolves:**\n';
                assignmentText += wolfAssignments.map(a => `• **${a.role}** - ${a.player}`).join('\n');
            }
            
            if (neutralAssignments.length > 0) {
                if (assignmentText) assignmentText += '\n\n';
                assignmentText += '**⚖️ Neutrals:**\n';
                assignmentText += neutralAssignments.map(a => `• **${a.role}** - ${a.player}`).join('\n');
            }

            // Count role occurrences for summary
            const roleCounts = {};
            roleData.forEach(roleInfo => {
                roleCounts[roleInfo.role] = (roleCounts[roleInfo.role] || 0) + 1;
            });

            const roleSummary = Object.entries(roleCounts)
                .map(([role, count]) => count > 1 ? `${role} (${count})` : role)
                .join(', ');

            const embed = new EmbedBuilder()
                .setTitle('🎭 Role Assignment Complete')
                .setDescription(isTestingMode ? 
                    'Testing mode: Assigned first role from the list to the single player!' : 
                    'Roles have been randomly assigned to all players!')
                .addFields(
                    { name: 'Team Assignments', value: assignmentText, inline: false },
                    { name: 'Role Summary', value: roleSummary, inline: false },
                    { name: 'Team Counts', value: `🏘️ Town: ${villageAssignments.length} | 🐺 Wolves: ${wolfAssignments.length} | ⚖️ Neutrals: ${neutralAssignments.length}`, inline: false },
                    { name: 'Game Info', value: `${game.game_name ? `${game.game_name} ` : ''}Game ${game.game_number}`, inline: true },
                    { name: 'Total Players', value: `${assignments.length}`, inline: true }
                )
                .setColor(isTestingMode ? 0xF39C12 : 0x00AE86)
                .setTimestamp()
                .setFooter({ text: isTestingMode ? 
                    'Testing Mode: Only first role assigned' : 
                    'Assignments are randomized each time this command is run' });

            // Add testing mode info if applicable
            if (isTestingMode) {
                embed.addFields({
                    name: '🧪 Testing Mode',
                    value: `Provided ${roleData.length} roles but only assigned the first one (${effectiveRoleData[0].role}) to test the system.`,
                    inline: false
                });
            }

            await message.reply({ embeds: [embed] });

            // Send a confirmation message
            const confirmEmbed = new EmbedBuilder()
                .setTitle('✅ Assignment Summary')
                .setDescription(isTestingMode ? 
                    `Testing mode: Assigned 1 role to 1 player (provided ${roleData.length} roles for testing).` :
                    `Successfully assigned ${roleData.length} roles to ${players.length} players with wolf flags set.`)
                .setColor(0x2ECC71);

            await message.reply({ embeds: [confirmEmbed] });

        } catch (error) {
            console.error('Error assigning roles:', error);
            await message.reply('❌ An error occurred while assigning roles.');
        }
    }

    getRoleBreakdown(roleData) {
        const village = roleData.filter(r => r.category === 'Village').map(r => r.role);
        const wolves = roleData.filter(r => r.category === 'Wolf').map(r => r.role);
        const neutrals = roleData.filter(r => r.category === 'Neutral').map(r => r.role);
        
        let breakdown = '';
        if (village.length > 0) breakdown += `**Village (${village.length}):** ${village.join(', ')}\n`;
        if (wolves.length > 0) breakdown += `**Wolves (${wolves.length}):** ${wolves.join(', ')}\n`;
        if (neutrals.length > 0) breakdown += `**Neutrals (${neutrals.length}):** ${neutrals.join(', ')}`;
        
        return breakdown || 'No roles provided';
    }

    async handleRolesList(message) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3) ORDER BY id DESC LIMIT 1',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Get all players with their roles
        const playersResult = await this.db.query(
            'SELECT user_id, username, role, status FROM players WHERE game_id = $1 ORDER BY username',
            [game.id]
        );

        if (playersResult.rows.length === 0) {
            return message.reply('❌ No players found in the current game.');
        }

        // Check if any roles have been assigned
        const playersWithRoles = playersResult.rows.filter(player => player.role !== null);
        
        if (playersWithRoles.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('🎭 Player Roles')
                .setDescription('No roles have been assigned yet. Use `Wolf.role_assign` to assign roles to players.')
                .addFields({
                    name: 'Players in Game',
                    value: playersResult.rows.map((p, i) => `${i + 1}. ${p.username}`).join('\n'),
                    inline: false
                })
                .setColor(0x95A5A6);

            return message.reply({ embeds: [embed] });
        }

        // Sort players by role assignment order (if they were assigned in order)
        // Players without roles will be at the end
        const sortedPlayers = [
            ...playersWithRoles,
            ...playersResult.rows.filter(player => player.role === null)
        ];

        // Create role list
        const rolesList = sortedPlayers.map((player, index) => {
            const statusIcon = player.status === 'alive' ? '💚' : '💀';
            const roleText = player.role ? `**${player.role}**` : '_No role assigned_';
            return `${statusIcon} ${roleText} - ${player.username}`;
        }).join('\n');

        // Count role occurrences
        const roleCounts = {};
        playersWithRoles.forEach(player => {
            roleCounts[player.role] = (roleCounts[player.role] || 0) + 1;
        });

        const roleSummary = Object.entries(roleCounts)
            .map(([role, count]) => count > 1 ? `${role} (${count})` : role)
            .join(', ');

        const embed = new EmbedBuilder()
            .setTitle('🎭 Player Roles')
            .setDescription(`Here are all the assigned roles for ${game.game_name ? `${game.game_name} ` : ''}Game ${game.game_number}:`)
            .addFields(
                { name: 'Role Assignments', value: rolesList, inline: false },
                { name: 'Role Summary', value: roleSummary || 'No roles assigned', inline: false },
                { name: 'Legend', value: '💚 = Alive | 💀 = Dead', inline: false }
            )
            .setColor(0x9B59B6)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }

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
    }

    async handleServer(message) {
        const serverId = message.guild.id;
        const serverName = message.guild.name;
        const memberCount = message.guild.memberCount;
        console.log(`Fetching server info for ${serverName} (${serverId}) with ${memberCount} members`);

        try {
            // Get server configuration
            const configResult = await this.db.query(
                'SELECT * FROM server_configs WHERE server_id = $1',
                [serverId]
            );

            let serverConfig = null;
            if (configResult.rows.length > 0) {
                serverConfig = configResult.rows[0];
            }

            // Get current active game
            const activeGameResult = await this.db.query(
                'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3) ORDER BY id DESC LIMIT 1',
                [serverId, 'signup', 'active']
            );

            let activeGame = null;
            let playerCount = 0;
            let aliveCount = 0;
            let gameChannels = [];

            if (activeGameResult.rows.length > 0) {
                activeGame = activeGameResult.rows[0];
                
                // Get player counts
                const playersResult = await this.db.query(
                    'SELECT COUNT(*) as total FROM players WHERE game_id = $1',
                    [activeGame.id]
                );
                playerCount = parseInt(playersResult.rows[0].total);

                // Count alive players by checking Discord roles
                const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
                if (aliveRole) {
                    const allPlayers = await this.db.query(
                        'SELECT user_id FROM players WHERE game_id = $1',
                        [activeGame.id]
                    );

                    for (const player of allPlayers.rows) {
                        try {
                            const member = await message.guild.members.fetch(player.user_id);
                            if (member && member.roles.cache.has(aliveRole.id)) {
                                aliveCount++;
                            }
                        } catch (error) {
                            // Member might have left the server
                            continue;
                        }
                    }
                }

                // Get additional game channels
                const additionalChannelsResult = await this.db.query(
                    'SELECT channel_id FROM game_channels WHERE game_id = $1',
                    [activeGame.id]
                );
                gameChannels = additionalChannelsResult.rows.map(row => row.channel_id);
            }

            // Get total games played on server
            const totalGamesResult = await this.db.query(
                'SELECT COUNT(*) as total FROM games WHERE server_id = $1',
                [serverId]
            );
            const totalGames = parseInt(totalGamesResult.rows[0].total);

            // Get role information
            const roles = {
                mod: message.guild.roles.cache.find(r => r.name === 'Mod'),
                spectator: message.guild.roles.cache.find(r => r.name === 'Spectator'),
                signedUp: message.guild.roles.cache.find(r => r.name === 'Signed Up'),
                alive: message.guild.roles.cache.find(r => r.name === 'Alive'),
                dead: message.guild.roles.cache.find(r => r.name === 'Dead')
            };

            // Build the embed
            const embed = new EmbedBuilder()
                .setTitle(`🖥️ Server Information: ${serverName}`)
                .setColor(0x3498DB)
                .setTimestamp()
                .setFooter({ text: `Server ID: ${serverId}` });

            // Basic server info
            embed.addFields(
                { name: '📊 Basic Info', value: `**Members:** ${memberCount}\n**Total Games:** ${totalGames}`, inline: true }
            );

            // Server configuration
            if (serverConfig) {
                embed.addFields({
                    name: '⚙️ Configuration',
                    value: `**Prefix:** ${serverConfig.game_prefix}\n**Game Counter:** ${serverConfig.game_counter}\n**Game Name:** ${serverConfig.game_name || 'Not set'}`,
                    inline: true
                });
            } else {
                embed.addFields({
                    name: '⚙️ Configuration',
                    value: '❌ Not configured\nRun `Wolf.setup` first',
                    inline: true
                });
            }

            // Role status
            const roleStatus = Object.entries(roles)
                .map(([roleName, role]) => `${role ? '✅' : '❌'} ${roleName.charAt(0).toUpperCase() + roleName.slice(1)}`)
                .join('\n');

            embed.addFields({
                name: '🎭 Role Status',
                value: roleStatus,
                inline: true
            });

            // Active game information
            if (activeGame) {
                let gameStatus = `**Status:** ${activeGame.status.charAt(0).toUpperCase() + activeGame.status.slice(1)}`;
                if (activeGame.status === 'active') {
                    gameStatus += `\n**Phase:** ${activeGame.day_phase.charAt(0).toUpperCase() + activeGame.day_phase.slice(1)} ${activeGame.day_number}`;
                }
                gameStatus += `\n**Players:** ${playerCount}`;
                if (activeGame.status === 'active') {
                    gameStatus += `\n**Alive:** ${aliveCount}`;
                }

                embed.addFields({
                    name: `🎮 Active Game: ${activeGame.game_name ? `${activeGame.game_name} ` : ''}Game ${activeGame.game_number}`,
                    value: gameStatus,
                    inline: false
                });

                // Game channels
                if (activeGame.status === 'active') {
                    const channels = [];
                    if (activeGame.town_square_channel_id) channels.push(`<#${activeGame.town_square_channel_id}>`);
                    if (activeGame.voting_booth_channel_id) channels.push(`<#${activeGame.voting_booth_channel_id}>`);
                    if (activeGame.wolf_chat_channel_id) channels.push(`<#${activeGame.wolf_chat_channel_id}>`);
                    if (activeGame.signup_channel_id) channels.push(`<#${activeGame.signup_channel_id}> (Dead Chat)`);
                    if (activeGame.memos_channel_id) channels.push(`<#${activeGame.memos_channel_id}>`);
                    if (activeGame.results_channel_id) channels.push(`<#${activeGame.results_channel_id}>`);
                    
                    // Add additional channels
                    for (const channelId of gameChannels) {
                        try {
                            const channel = await message.guild.channels.fetch(channelId);
                            if (channel) {
                                channels.push(`<#${channelId}>`);
                            }
                        } catch (error) {
                            channels.push(`❌ Deleted channel (${channelId})`);
                        }
                    }

                    if (channels.length > 0) {
                        embed.addFields({
                            name: '📢 Game Channels',
                            value: channels.join('\n'),
                            inline: false
                        });
                    }
                }
            } else {
                embed.addFields({
                    name: '🎮 Active Game',
                    value: 'No active game',
                    inline: false
                });
            }

            // Database connectivity test
            try {
                await this.db.query('SELECT 1');
                embed.addFields({
                    name: '🗄️ Database',
                    value: '✅ Connected',
                    inline: true
                });
            } catch (error) {
                embed.addFields({
                    name: '🗄️ Database',
                    value: '❌ Connection Error',
                    inline: true
                });
            }

            // Bot information
            embed.addFields({
                name: '🤖 Bot Info',
                value: `**Prefix:** ${this.prefix}\n**Uptime:** ${process.uptime().toFixed(0)}s`,
                inline: true
            });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error getting server information:', error);
            await message.reply('❌ An error occurred while retrieving server information.');
        }
    }

    // Helper function to calculate string similarity using Levenshtein distance
    calculateSimilarity(str1, str2) {
        str1 = str1.toLowerCase();
        str2 = str2.toLowerCase();
        
        const matrix = [];
        
        // Create matrix
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        // Fill matrix
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        const distance = matrix[str2.length][str1.length];
        const maxLength = Math.max(str1.length, str2.length);
        
        // Return similarity as percentage (higher = more similar)
        return ((maxLength - distance) / maxLength) * 100;
    }

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
    }

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
    }

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
    }

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
    }

    async handleMeme(message) {
        try {
            const username = message.author.username.toLowerCase();
            const displayName = message.member ? message.member.displayName.toLowerCase() : '';
            
            // Check if the user has "geese" in their username or display name
            if (username.includes('geese') || displayName.includes('geese')) {
                await message.reply('And especially you! You\'re not getting anything from me');
            } else {
                await message.reply('Are you kidding me? After all the vitriol you put me through, you expect me to just give you a little funny quip or joke? I\'ll give you something to laugh about if youre not careful');
            }
        } catch (error) {
            console.error('Error handling meme command:', error);
            await message.reply('❌ An error occurred while processing the meme command.');
        }
    }

}

module.exports = WerewolfBot;
