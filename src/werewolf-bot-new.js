const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

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
        const playerCommands = ['in', 'out', 'vote', 'retract', 'help'];
        
        // Check permissions for admin-only commands
        if (!playerCommands.includes(command) && !this.hasModeratorPermissions(message.member)) {
            return message.reply('❌ You need moderator permissions to use this command.');
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
                default:
                    await message.reply('❓ Unknown command. Use `Wolf.help` for available commands.');
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

        const signupChannelName = `${config.game_prefix}${config.game_counter}-signups`;
        const signupChannel = await message.guild.channels.create({
            name: signupChannelName,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        // Save game to database
        await this.db.query(
            `INSERT INTO games (server_id, game_number, game_name, signup_channel_id, category_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [serverId, config.game_counter, config.game_name, signupChannel.id, category.id]
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

        // Rename signup channel to dead-chat
        const signupChannel = await this.client.channels.fetch(game.signup_channel_id);
        await signupChannel.setName(`${config.game_prefix}${game.game_number}-dead-chat`);

        // Create game channels
        const category = await this.client.channels.fetch(game.category_id);
        
        const townSquare = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-town-square`,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        const wolfChat = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-wolf-chat`,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        const memos = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-memos`,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        const results = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-results`,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        const votingBooth = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-voting-booth`,
            type: ChannelType.GuildText,
            parent: category.id,
        });

        const breakdown = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-breakdown`,
            type: ChannelType.GuildText,
            parent: category.id,
        });

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

        // Send initial voting message
        await this.createVotingMessage(game.id, votingBooth);

        // Send player list to dead chat
        await this.sendPlayerListToDeadChat(game.id, signupChannel);

        const embed = new EmbedBuilder()
            .setTitle('🎮 Game Started!')
            .setDescription('All game channels have been created. The game has officially begun!\n\n🌙 **Night 1** - Wolves, make your moves!')
            .addFields(
                { name: 'Town Square', value: `<#${townSquare.id}>`, inline: true },
                { name: 'Wolf Chat', value: `<#${wolfChat.id}>`, inline: true },
                { name: 'Memos', value: `<#${memos.id}>`, inline: true },
                { name: 'Results', value: `<#${results.id}>`, inline: true },
                { name: 'Voting Booth', value: `<#${votingBooth.id}>`, inline: true },
                { name: 'Breakdown', value: `<#${breakdown.id}>`, inline: true },
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
            .setTitle(`🗳️ Day ${dayNumber + 1} Voting`)
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

        // Check if voter is in the game
        const voterCheck = await this.db.query(
            'SELECT * FROM players WHERE game_id = $1 AND user_id = $2 AND status = $3',
            [game.id, voterId, 'alive']
        );

        if (!voterCheck.rows.length) {
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

        // Check if target is in the game
        const targetCheck = await this.db.query(
            'SELECT * FROM players WHERE game_id = $1 AND user_id = $2 AND status = $3',
            [game.id, target.id, 'alive']
        );

        if (!targetCheck.rows.length) {
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
            
            // Clear votes for new day
            await this.db.query(
                'DELETE FROM votes WHERE game_id = $1 AND day_number = $2',
                [game.id, game.day_number]
            );
        }

        // Update game phase
        await this.db.query(
            'UPDATE games SET day_phase = $1, day_number = $2 WHERE id = $3',
            [newPhase, newDay, game.id]
        );

        // If it's a new day, create new voting message
        if (newPhase === 'day') {
            const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
            await this.createVotingMessage(game.id, votingChannel);
        }

        const embed = new EmbedBuilder()
            .setTitle('🌅 Phase Change')
            .setDescription(`It is now **${newPhase}** of day ${newDay}.`)
            .setColor(newPhase === 'day' ? 0xF1C40F : 0x2C3E50);

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

        const successEmbed = new EmbedBuilder()
            .setTitle('🏁 Game Ended')
            .setDescription('The game has been officially ended. All data has been preserved.')
            .setColor(0x95A5A6);

        await message.reply({ embeds: [successEmbed] });
    }

    async handleRefresh(message) {
        const serverId = message.guild.id;

        // Confirmation
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Server Refresh')
            .setDescription('Are you sure you want to refresh this server? This will:\n\n• Delete ALL game channels and categories\n• Reset game counter to 1\n• End any active games\n\nThis action cannot be undone!')
            .setColor(0xE74C3C);

        await message.reply({ embeds: [embed] });
        await message.reply('Type `confirm` to refresh the server or `cancel` to abort.');

        const filter = (m) => m.author.id === message.author.id && ['confirm', 'cancel'].includes(m.content.toLowerCase());
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });

        if (!collected.size || collected.first().content.toLowerCase() === 'cancel') {
            return message.reply('❌ Server refresh cancelled.');
        }

        try {
            // Get all games for this server
            const gamesResult = await this.db.query(
                'SELECT * FROM games WHERE server_id = $1',
                [serverId]
            );

            // Delete all game channels and categories
            for (const game of gamesResult.rows) {
                // Delete category (this will delete all channels in it)
                if (game.category_id) {
                    try {
                        const category = await this.client.channels.fetch(game.category_id);
                        if (category) {
                            await category.delete();
                        }
                    } catch (error) {
                        console.log(`Category ${game.category_id} not found or already deleted`);
                    }
                }
            }

            // Clear database data for this server
            await this.db.query('DELETE FROM votes WHERE game_id IN (SELECT id FROM games WHERE server_id = $1)', [serverId]);
            await this.db.query('DELETE FROM players WHERE game_id IN (SELECT id FROM games WHERE server_id = $1)', [serverId]);
            await this.db.query('DELETE FROM games WHERE server_id = $1', [serverId]);
            
            // Reset game counter to 1
            await this.db.query(
                'UPDATE server_configs SET game_counter = 1 WHERE server_id = $1',
                [serverId]
            );

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Server Refreshed')
                .setDescription('Server has been successfully refreshed!\n\n• All game channels deleted\n• Game counter reset to 1\n• Database cleaned\n\nYou can now create a new game with `Wolf.create`.')
                .setColor(0x00AE86);

            await message.reply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error during server refresh:', error);
            await message.reply('❌ An error occurred during the refresh. Some channels may need to be manually deleted.');
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
            { name: 'Wolf.help', value: 'Show this help message', inline: false }
        );

        // Admin commands (only if user is admin)
        if (isAdmin) {
            embed.addFields(
                { name: 'Moderator Commands', value: 'Commands only moderators can use:', inline: false },
                { name: 'Wolf.setup', value: 'Initial server setup - configure game prefix, starting number, and game name', inline: false },
                { name: 'Wolf.create', value: 'Create a new game with signup channel', inline: false },
                { name: 'Wolf.start', value: 'Start the game and create all game channels', inline: false },
                { name: 'Wolf.next', value: 'Move to the next phase (day/night)', inline: false },
                { name: 'Wolf.end', value: 'End the current game (requires confirmation)', inline: false },
                { name: 'Wolf.refresh', value: '🔄 Reset entire server (delete all channels, reset to game 1) - for testing only!', inline: false }
            );
        } else {
            embed.setFooter({ text: 'Note: Some commands are only available to moderators.' });
        }

        await message.reply({ embeds: [embed] });
    }
}

module.exports = WerewolfBot;
