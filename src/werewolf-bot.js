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

        // Commands that anyone can use, they will not be able to use help since it shows admin commands
        const playerCommands = ['in', 'out', 'vote', 'retract', 'alive'];
        
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
                case 'roles':
                    await this.handleRoles(message);
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
                case 'day':
                    await this.handleDayMessage(message, args);
                    break;
                case 'night':
                    await this.handleNightMessage(message, args);
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
                case 'ia':
                    await this.handleIA(message, args);
                    break;
                case 'speed':
                    await this.handleSpeed(message, args);
                    break;
                case 'peed':
                    await message.reply('💦 IM PISSING REALLY HARD AND ITS REALLY COOL 💦');
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

    async setupChannelPermissions(game, deadChat, townSquare, wolfChat, memos, results, votingBooth) {
        const guild = deadChat.guild;
        const aliveRole = guild.roles.cache.find(r => r.name === 'Alive');
        const deadRole = guild.roles.cache.find(r => r.name === 'Dead');
        const spectatorRole = guild.roles.cache.find(r => r.name === 'Spectator');
        const modRole = guild.roles.cache.find(r => r.name === 'Mod');

        try {
            // Dead Chat permissions: Dead can see and type, Alive cannot see, Spectators can see and type
            if (deadRole && aliveRole && spectatorRole) {
                await deadChat.permissionOverwrites.edit(guild.roles.everyone.id, {
                    ViewChannel: false,
                    SendMessages: false
                });
                await deadChat.permissionOverwrites.edit(deadRole.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
                await deadChat.permissionOverwrites.edit(aliveRole.id, {
                    ViewChannel: false
                });
                await deadChat.permissionOverwrites.edit(spectatorRole.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
            }

            // Game channels: Alive can see and type, Dead can see but not type (except dead chat), Spectators cannot see
            const gameChannels = [townSquare, memos, votingBooth];
            for (const channel of gameChannels) {
                if (aliveRole && deadRole && spectatorRole) {
                    await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
                        ViewChannel: false,
                        SendMessages: false
                    });
                    await channel.permissionOverwrites.edit(aliveRole.id, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                    await channel.permissionOverwrites.edit(deadRole.id, {
                        ViewChannel: true,
                        SendMessages: false
                    });
                    await channel.permissionOverwrites.edit(spectatorRole.id, {
                        ViewChannel: true,
                        SendMessages: false
                    });
                }
            }

            // Results channel: Only Mod can type, everyone else can see but not type
            if (results && modRole && aliveRole && deadRole && spectatorRole) {
                await results.permissionOverwrites.edit(guild.roles.everyone.id, {
                    ViewChannel: false,
                    SendMessages: false
                });
                await results.permissionOverwrites.edit(aliveRole.id, {
                    ViewChannel: true,
                    SendMessages: false
                });
                await results.permissionOverwrites.edit(deadRole.id, {
                    ViewChannel: true,
                    SendMessages: false
                });
                await results.permissionOverwrites.edit(spectatorRole.id, {
                    ViewChannel: true,
                    SendMessages: false
                });
                await results.permissionOverwrites.edit(modRole.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
            }

            // Wolf Chat: Mods can see and type, everyone else cannot see. Mod will manually set this channels permissions
            if (wolfChat && modRole && spectatorRole && aliveRole) {
                await wolfChat.permissionOverwrites.edit(guild.roles.everyone.id, {
                    ViewChannel: false,
                    SendMessages: false
                });
                await wolfChat.permissionOverwrites.edit(modRole.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
                await wolfChat.permissionOverwrites.edit(spectatorRole.id, {
                    ViewChannel: true,
                    SendMessages: false
                });
                await wolfChat.permissionOverwrites.edit(aliveRole.id, {
                    ViewChannel: false,
                    SendMessages: true
                });
            }

            // Mod chat is already set up in channel creation
            console.log('Channel permissions set up successfully');
        } catch (error) {
            console.error('Error setting up channel permissions:', error);
        }
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

        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');

        const modChatName = `${config.game_prefix}${config.game_counter}-mod-chat`;
        const modChat = await message.guild.channels.create({
            name: modChatName,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        await modChat.permissionOverwrites.edit(message.guild.roles.everyone.id, {
            ViewChannel: false,
            SendMessages: false
        });
        await modChat.permissionOverwrites.edit(modRole.id, {
            ViewChannel: true,
            SendMessages: true
        });

        const breakdownName = `${config.game_prefix}${config.game_counter}-breakdown`;
        const breakdown = await message.guild.channels.create({
            name: breakdownName,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        await breakdown.permissionOverwrites.edit(message.guild.roles.everyone.id, {
            ViewChannel: true,
            SendMessages: false
        });
        await breakdown.permissionOverwrites.edit(modRole.id, {
            ViewChannel: true,
            SendMessages: true
        });

        const signupChannelName = `${config.game_prefix}${config.game_counter}-signups`;
        const signupChannel = await message.guild.channels.create({
            name: signupChannelName,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        // Save game to database
        await this.db.query(
            `INSERT INTO games (server_id, game_number, game_name, signup_channel_id, category_id, mod_chat_channel_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [serverId, config.game_counter, config.game_name, signupChannel.id, category.id, modChat.id]
        );

        // Update server config counter
        await this.db.query(
            'UPDATE server_configs SET game_counter = game_counter + 1 WHERE server_id = $1',
            [serverId]
        );

        const embed = new EmbedBuilder()
            .setTitle('🎮 New Game Created!')
            .setDescription(`Game ${config.game_counter} has been created.`)
            .addFields(
                { name: 'Category', value: categoryName, inline: true },
                { name: 'Signup Channel', value: `<#${signupChannel.id}>`, inline: true }
            )
            .setColor(0x00AE86);

        await message.reply({ embeds: [embed] });
        
        const signupEmbed = new EmbedBuilder()
            .setTitle('🐺 Werewolf Game Signups')
            .setDescription('A new game is starting! Use `Wolf.in` to join or `Wolf.out` to leave.')
            .setColor(0x3498DB);

        await signupChannel.send({ embeds: [signupEmbed] });
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

        try {
            const channel = await this.client.channels.fetch(game.signup_channel_id);
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMessage = messages.find(msg => msg.author.bot && msg.embeds.length > 0);
            
            if (botMessage) {
                await botMessage.edit({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error updating signup message:', error);
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

        // 2. Results
        const results = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-results`,
            type: ChannelType.GuildText,
            parent: category.id,
        });
        await results.setPosition(signupChannel.position); // Position results above the signup channel

        // 3. Player-memos
        const memos = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-player-memos`,
            type: ChannelType.GuildText,
            parent: category.id,
        });
        await memos.setPosition(results.position + 1); // Position memos below results

        // 4. Townsquare
        const townSquare = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-townsquare`,
            type: ChannelType.GuildText,
            parent: category.id,
        });
        await townSquare.setPosition(memos.position + 1); // Position town square below memos

        // 5. Voting-Booth
        const votingBooth = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-voting-booth`,
            type: ChannelType.GuildText,
            parent: category.id,
        });
        await votingBooth.setPosition(townSquare.position + 1); // Position voting booth below town square

        // 6. <added channels> will be positioned here when created with Wolf.add_channel

        // 7. Wolf-Chat
        const wolfChat = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-wolf-chat`,
            type: ChannelType.GuildText,
            parent: category.id,
        });
        await wolfChat.setPosition(votingBooth.position + 1); // Position wolf chat below voting booth

        // Rename signup channel to dead-chat
        await signupChannel.setName(`${config.game_prefix}${game.game_number}-dead-chat`);
        
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

        // Set up channel permissions for game roles
        await this.setupChannelPermissions(game, signupChannel, townSquare, wolfChat, memos, results, votingBooth);

        // Update game in database
        await this.db.query(
            `UPDATE games SET 
             status = 'active',
             day_phase = 'night',
             day_number = 1,
             town_square_channel_id = $1,
             wolf_chat_channel_id = $2,
             memos_channel_id = $3,
             results_channel_id = $4,
             voting_booth_channel_id = $5
             WHERE id = $6`,
            [townSquare.id, wolfChat.id, memos.id, results.id, votingBooth.id, game.id]
        );

        // Send player list to dead chat
        await this.sendPlayerListToDeadChat(game.id, signupChannel);

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

        await message.reply({ embeds: [embed] });
    }

    async createVotingMessage(gameId, votingChannel) {
        // Get the current game to check day number
        const gameResult = await this.db.query('SELECT day_number FROM games WHERE id = $1', [gameId]);
        const dayNumber = gameResult.rows[0]?.day_number || 1;
        
        const embed = new EmbedBuilder()
            .setTitle(`🗳️ Day ${dayNumber} Voting`)
            .setDescription('Use `Wolf.vote @user` to vote for someone.\nUse `Wolf.retract` to retract your vote.')
            .addFields({ name: 'Current Votes', value: 'No votes yet.' })
            .setColor(0xE74C3C);

        await votingChannel.send({ embeds: [embed] });
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
        if (target.id === voterId) {
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
            const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
            const messages = await votingChannel.messages.fetch({ limit: 10 });
            const votingMessage = messages.find(msg => msg.author.bot && msg.embeds.length > 0);

            if (!votingMessage) return;

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
                .setDescription('Use `Wolf.vote @user` to vote for someone.\nUse `Wolf.retract` to retract your vote.')
                .addFields({ name: 'Current Votes', value: voteText })
                .setColor(0xE74C3C);

            await votingMessage.edit({ embeds: [embed] });
        } catch (error) {
            console.error('Error updating voting message:', error);
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

        // Clear all votes for the game at the end of each day
        if (game.day_phase === 'day') {
            await this.db.query(
                'DELETE FROM votes WHERE game_id = $1',
                [game.id]
            );
        }

        // Update game phase
        await this.db.query(
            'UPDATE games SET day_phase = $1, day_number = $2 WHERE id = $3',
            [newPhase, newDay, game.id]
        );

        // Use custom messages or defaults
        const phaseMessage = newPhase === 'day' ? game.day_message : game.night_message;
        
        const title = newPhase === 'day' ? '🌞 Day Time!' : '🌙 Night Time!';

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(`It is now **${newPhase} ${newDay}**.\n\n${phaseMessage}`)
            .setColor(newPhase === 'day' ? 0xF1C40F : 0x2C3E50);

        // Post phase change message to all game channels
        const gameChannelIds = [
            game.voting_booth_channel_id,
            game.wolf_chat_channel_id,
            game.town_square_channel_id
        ].filter(id => id); // Filter out any null/undefined channel IDs

        // Get additional channels created with add_channel command
        const additionalChannels = await this.db.query(
            'SELECT channel_id FROM game_channels WHERE game_id = $1',
            [game.id]
        );

        // Add additional channel IDs to the list
        additionalChannels.rows.forEach(row => {
            gameChannelIds.push(row.channel_id);
        });

        // Send the phase change message to all game channels
        const channelPromises = gameChannelIds.map(async (channelId) => {
            try {
                const channel = await this.client.channels.fetch(channelId);
                if (channel) {
                    await channel.send({ embeds: [embed] });
                }
            } catch (error) {
                console.error(`Error sending phase message to channel ${channelId}:`, error);
            }
        });

        // Wait for all channel messages to be sent
        await Promise.all(channelPromises);


        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        // If it's a new day (day 2 or later), create new voting message
        const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
        if (newPhase === 'day' && newDay >= 2) {
            await this.createVotingMessage(game.id, votingChannel);

            // Reopen voting booth channel
            await votingChannel.permissionOverwrites.edit(aliveRole.id, {
                ViewChannel: true,
                SendMessages: true
            });
        }
        else {
            // Close voting booth channel for the night phase
            await votingChannel.permissionOverwrites.edit(aliveRole.id, {
                ViewChannel: true,
                SendMessages: false
            });
        }

        // Also reply to the command user
        await message.reply({ embeds: [embed] });
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

    async handleRoles(message) {
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

        // Player commands (everyone can use)
        embed.addFields(
            { name: 'Player Commands', value: 'Commands anyone can use:', inline: false },
            { name: 'Wolf.in', value: 'Sign up for the current game', inline: false },
            { name: 'Wolf.out', value: 'Remove yourself from the current game', inline: false },
            { name: 'Wolf.vote @user', value: 'Vote for a player (only in voting booth during day)', inline: false },
            { name: 'Wolf.retract', value: 'Retract your current vote', inline: false },
            { name: 'Wolf.alive', value: 'Show all players currently alive in the game', inline: false },
            { name: 'Wolf.inlist', value: 'Show all players signed up for the current game (mobile-friendly format)', inline: false },
            { name: 'Wolf.help', value: 'Show this help message', inline: false }
        );

        // Admin commands (only if user is admin)
        if (isAdmin) {
            embed.addFields(
                { name: 'Moderator Commands', value: 'Commands only moderators can use:', inline: false },
                { name: 'Wolf.setup', value: 'Initial server setup - configure game prefix, starting number, and game name', inline: false },
                { name: 'Wolf.roles', value: '🎭 Create all game roles (Mod, Spectator, Signed Up, Alive, Dead)', inline: false },
                { name: 'Wolf.create', value: 'Create a new game with signup channel', inline: false },
                { name: 'Wolf.start', value: 'Start the game and create all game channels', inline: false },
                { name: 'Wolf.next', value: 'Move to the next phase (day/night)', inline: false },
                { name: 'Wolf.end', value: 'End the current game (requires confirmation)', inline: false },

                { name: 'Wolf.add_channel <name>', value: 'Create an additional channel in the game category', inline: false },
                { name: 'Wolf.day <message>', value: 'Set custom day transition message', inline: false },
                { name: 'Wolf.night <message>', value: 'Set custom night transition message', inline: false },
                { name: 'Wolf.journal @user', value: '📔 Create a personal journal for a player', inline: false },
                { name: 'Wolf.ia <YYYY-MM-DD HH:MM>', value: '📊 Get message count per player in town square since specified date/time (EST)', inline: false },
                { name: 'Wolf.speed <number>', value: '⚡ Start a speed vote with target number of reactions (use "abort" to cancel)', inline: false },
                { name: 'Wolf.recovery', value: '🔄 Recovery mode - migrate from manual game management to bot control', inline: false },
                { name: 'Wolf.refresh', value: '🔄 Reset server (delete all channels except #general, reset to game 1) - for testing only!', inline: false }
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
            'SELECT username FROM players WHERE game_id = $1 ORDER BY signed_up_at',
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

        // Get server config for prefix
        const configResult = await this.db.query(
            'SELECT * FROM server_configs WHERE server_id = $1',
            [serverId]
        );
        const config = configResult.rows[0];

        // Create the full channel name with prefix
        const fullChannelName = `${config.game_prefix}${game.game_number}-${channelName}`;

        try {
            // Create the channel in the game category
            const category = await this.client.channels.fetch(game.category_id);
            const newChannel = await message.guild.channels.create({
                name: fullChannelName,
                type: ChannelType.GuildText,
                parent: category.id,
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

            // Set up permissions for the new channel (same as other game channels)
            const guild = message.guild;
            const aliveRole = guild.roles.cache.find(r => r.name === 'Alive');
            const deadRole = guild.roles.cache.find(r => r.name === 'Dead');
            const spectatorRole = guild.roles.cache.find(r => r.name === 'Spectator');

            if (aliveRole && deadRole && spectatorRole) {
                await newChannel.permissionOverwrites.edit(guild.roles.everyone.id, {
                    ViewChannel: false,
                    SendMessages: false
                });
                await newChannel.permissionOverwrites.edit(aliveRole.id, {
                    ViewChannel: false,
                    SendMessages: false
                });
                await newChannel.permissionOverwrites.edit(deadRole.id, {
                    ViewChannel: true,
                    SendMessages: false
                });
                await newChannel.permissionOverwrites.edit(spectatorRole.id, {
                    ViewChannel: true,
                    SendMessages: false
                });
            }

            // Save channel to database
            await this.db.query(
                'INSERT INTO game_channels (game_id, channel_id, channel_name) VALUES ($1, $2, $3)',
                [game.id, newChannel.id, fullChannelName]
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

    async handleDayMessage(message, args) {
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

        // Check if message is provided
        if (!args.length) {
            return message.reply(`❌ Please provide a day message. Usage: \`Wolf.day <message>\`\n\nCurrent day message: "${game.day_message}"`);
        }

        const newMessage = args.join(' ');

        try {
            // Update the day message
            await this.db.query(
                'UPDATE games SET day_message = $1 WHERE id = $2',
                [newMessage, game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('🌅 Day Message Updated')
                .setDescription('Successfully updated the day transition message!')
                .addFields(
                    { name: 'New Day Message', value: newMessage, inline: false }
                )
                .setColor(0xF1C40F);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error updating day message:', error);
            await message.reply('❌ An error occurred while updating the day message.');
        }
    }

    async handleNightMessage(message, args) {
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

        // Check if message is provided
        if (!args.length) {
            return message.reply(`❌ Please provide a night message. Usage: \`Wolf.night <message>\`\n\nCurrent night message: "${game.night_message}"`);
        }

        const newMessage = args.join(' ');

        try {
            // Update the night message
            await this.db.query(
                'UPDATE games SET night_message = $1 WHERE id = $2',
                [newMessage, game.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('🌙 Night Message Updated')
                .setDescription('Successfully updated the night transition message!')
                .addFields(
                    { name: 'New Night Message', value: newMessage, inline: false }
                )
                .setColor(0x2C3E50);

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error updating night message:', error);
            await message.reply('❌ An error occurred while updating the night message.');
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
            argumentsArray = [new Date().toISOString().split('T')[0], '09:30'];
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

            // Initialize message count object
            const messageCounts = {};
            playersResult.rows.forEach(player => {
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

}

module.exports = WerewolfBot;
