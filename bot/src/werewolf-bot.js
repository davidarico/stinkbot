const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const OpenAI = require('openai');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Client } = require('@opensearch-project/opensearch');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

// Import services
const ImageService = require('./services/image-service');
const RoleService = require('./services/role-service');
const OpenAIService = require('./services/openai-service');

// Import command loader
const { loadCommands } = require('./command-loader');

// https://discord.com/developers/docs/topics/permissions?pubDate=20250525
// I would expect this to appear within PermissionFlagBits but we likely need to update discord.js version. I don't want to risk that right now.
const PIN_PERMISSION = 0x0008000000000000;

class WerewolfBot {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.prefix = process.env.BOT_PREFIX || 'Wolf.';

        // Initialize OpenAI client if API key is available
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        } else {
            this.openai = null;
        }

        // Initialize S3 client if credentials are available
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION) {
            this.s3Client = new S3Client({
                region: process.env.AWS_REGION,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                }
            });
        } else {
            this.s3Client = null;
        }

        // Initialize OpenSearch client if endpoint is available
        if (process.env.OPENSEARCH_DOMAIN_ENDPOINT) {
            const endpoint = process.env.OPENSEARCH_DOMAIN_ENDPOINT;

            // Check if this is a local endpoint (no AWS authentication needed)
            if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.startsWith('http://')) {
                // Local OpenSearch instance - check for basic authentication
                const clientConfig = {
                    node: endpoint
                };

                if (process.env.OS_BASIC_USER && process.env.OS_BASIC_PASS) {
                    clientConfig.auth = {
                        username: process.env.OS_BASIC_USER,
                        password: process.env.OS_BASIC_PASS
                    };
                }

                this.openSearchClient = new Client(clientConfig);
            } else {
                // AWS OpenSearch instance - use AWS authentication
                if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION) {
                    this.openSearchClient = new Client({
                        ...createAwsSigv4Signer({
                            region: process.env.AWS_REGION,
                            service: 'es',
                            getCredentials: () => {
                                return Promise.resolve({
                                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                                });
                            },
                        }),
                        node: endpoint,
                    });
                } else {
                    console.warn('⚠️ OpenSearch endpoint provided but AWS credentials missing for remote endpoint');
                    this.openSearchClient = null;
                }
            }
        } else {
            this.openSearchClient = null;
        }

        // Initialize services
        this.imageService = new ImageService(this.s3Client);
        this.roleService = new RoleService();
        this.openaiService = new OpenAIService(this.openai);

        // Load commands
        const commandsPath = path.join(__dirname, 'commands');
        this.commands = loadCommands(commandsPath);
        console.log(`\n🎮 WerewolfBot initialized with ${this.commands.size} commands\n`);
    }

    // Delegate image methods to ImageService
    async downloadImage(url) {
        return this.imageService.downloadImage(url);
    }

    async uploadImageToS3(imageBuffer, originalUrl, messageId, imageIndex = 0) {
        return this.imageService.uploadImageToS3(imageBuffer, originalUrl, messageId, imageIndex);
    }

    getImageExtension(url) {
        return this.imageService.getImageExtension(url);
    }

    getContentType(extension) {
        return this.imageService.getContentType(extension);
    }

    async processDiscordImages(messageContent, messageId) {
        return this.imageService.processDiscordImages(messageContent, messageId);
    }

    // Delegate to OpenAIService
    async generateFunnyResponse(command, username) {
        return this.openaiService.generateFunnyResponse(command, username);
    }
    
    async handleMessage(message) {
        // Check if message starts with prefix (case insensitive)
        if (!message.content.toLowerCase().startsWith(this.prefix.toLowerCase())) {
            return;
        }

        const args = message.content.slice(this.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        // Get the command
        const command = this.commands.get(commandName);

        if (!command) {
            // Unknown command - generate funny response
            const funnyResponse = await this.openaiService.generateFunnyResponse(
                commandName,
                message.author.displayName
            );
            if (funnyResponse) {
                await message.reply(funnyResponse);
            } else {
                await message.reply('❓ Unknown command bozo. (Or you fuckers used up all the tokens)');
            }
            return;
        }

        // Check permissions for admin-only commands
        if (!command.playerCommand && !this.hasModeratorPermissions(message.member)) {
            const funnyResponse = await this.openaiService.generateFunnyResponse(
                commandName,
                message.author.displayName
            );
            if (funnyResponse) {
                await message.reply(funnyResponse);
            } else {
                await message.reply('❓ Unknown command bozo. (Or you fuckers used up all the tokens)');
            }
            return;
        }

        // Execute the command
        try {
            await command.execute(this, message, args);
        } catch (error) {
            console.error(`Error executing command '${commandName}':`, error);
            await message.reply('❌ An error occurred while processing your command.');
        }
    }

    hasModeratorPermissions(member) {
        return member.permissions.has(PermissionFlagsBits.ManageChannels) || 
               member.permissions.has(PermissionFlagsBits.Administrator);
    }

    isPublicChannel(message) {
        const channelName = message.channel.name.toLowerCase();
        return !channelName.includes('dead-chat') && !channelName.includes('mod-chat');
    }

    // Delegate role methods to RoleService
    async assignRole(member, roleName) {
        return this.roleService.assignRole(member, roleName);
    }

    async removeRole(member, roleName) {
        return this.roleService.removeRole(member, roleName);
    }

    async assignSpectatorRole(member) {
        return this.roleService.assignSpectatorRole(member);
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
        let wolvesAddedToChat = 0;
        let wolfChatMessage = '';

        try {
            // Get game information including theme flags
            const gameResult = await this.db.query(
                'SELECT is_skinned, is_themed, wolf_chat_channel_id FROM games WHERE id = $1',
                [gameId]
            );

            if (!gameResult.rows.length) {
                console.error('Game not found:', gameId);
                return { sent, failed };
            }

            const game = gameResult.rows[0];

            // Get all players in the game with their role information
            const playersResult = await this.db.query(
                `SELECT p.user_id, p.username, p.role_id, p.is_wolf, 
                        r.name as role_name, r.in_wolf_chat, r.team,
                        gr.custom_name, p.charges_left, p.win_by_number
                 FROM players p
                 LEFT JOIN roles r ON p.role_id = r.id
                 LEFT JOIN game_role gr ON p.game_id = gr.game_id AND p.role_id = gr.role_id
                 WHERE p.game_id = $1`,
                [gameId]
            );

            // Collect wolf team information for wolf chat message
            const wolfTeam = [];
            const wolfRolesNotInChat = [];

            console.log(`[DEBUG] Processing ${playersResult.rows.length} players for role notifications`);

            for (const player of playersResult.rows) {
                try {
                    // Skip players without assigned roles
                    if (!player.role_id) {
                        failed++;
                        console.log(`Skipping ${player.username} - no role assigned`);
                        continue;
                    }

                    console.log(`[DEBUG] Processing ${player.username}: role=${player.role_name}, is_wolf=${player.is_wolf}, in_wolf_chat=${player.in_wolf_chat}`);

                    // Determine what role name to display based on theme flags
                    let displayRoleName = player.role_name;
                    let fullRoleDescription = player.role_name;

                    if (game.is_themed && player.custom_name) {
                        // Themed mode: only show custom name
                        displayRoleName = player.custom_name;
                        fullRoleDescription = player.custom_name;
                    } else if (game.is_skinned && player.custom_name) {
                        // Skinned mode: show custom name with actual role in parens
                        displayRoleName = `${player.custom_name} (${player.role_name})`;
                        fullRoleDescription = `${player.custom_name} (${player.role_name})`;
                    } else {
                        // Normal mode: show actual role name
                        displayRoleName = player.role_name;
                        fullRoleDescription = player.role_name;
                    }

                    // Check if this is a wolf role that should be added to wolf chat
                    if (player.is_wolf && player.in_wolf_chat) {
                        console.log(`[DEBUG] Adding ${player.username} to wolf chat as ${displayRoleName}`);
                        
                        // Add to wolf team list for wolf chat message
                        wolfTeam.push({
                            username: player.username,
                            roleName: displayRoleName,
                            fullRoleDescription: fullRoleDescription,
                            charges: player.charges_left,
                            winByNumber: player.win_by_number
                        });

                        // Add player to wolf chat channel
                        if (game.wolf_chat_channel_id) {
                            try {
                                const wolfChannel = await this.client.channels.fetch(game.wolf_chat_channel_id);
                                if (wolfChannel) {
                                    // Add the player to the wolf chat channel
                                    const member = await this.client.guilds.cache.first().members.fetch(player.user_id);
                                    if (member) {
                                        await wolfChannel.permissionOverwrites.edit(member.id, {
                                            ViewChannel: true,
                                            [PIN_PERMISSION]: true
                                        });
                                        wolvesAddedToChat++;
                                        console.log(`[DEBUG] Successfully added ${player.username} to wolf chat`);
                                    }
                                }
                            } catch (error) {
                                console.error(`Error adding ${player.username} to wolf chat:`, error);
                            }
                        }

                        // Skip sending role notification to journal since they're in wolf chat
                        console.log(`Skipping role notification for ${player.username} - added to wolf chat`);
                        continue;
                    }

                    // Check if this is a wolf role that's NOT in wolf chat
                    if (player.is_wolf && !player.in_wolf_chat) {
                        console.log(`[DEBUG] Found wolf role not in chat: ${player.username} as ${displayRoleName}`);
                        wolfRolesNotInChat.push({
                            roleName: displayRoleName,
                            fullRoleDescription: fullRoleDescription,
                            charges: player.charges_left,
                            winByNumber: player.win_by_number
                        });
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
                        .setDescription(`**${displayRoleName}**!`)
                        .setColor(0x9B59B6)
                        .setTimestamp()
                        .setFooter({ text: 'Good luck and have fun!' });

                    // Add charges information if the player has charges
                    if (player.charges_left !== null && player.charges_left !== undefined && player.charges_left > 0) {
                        roleEmbed.addFields({
                            name: '⚡ Charges',
                            value: `You have **${player.charges_left} charges**.`,
                            inline: true
                        });
                    }

                    // Add win by number information if the player has a win condition
                    if (player.win_by_number !== null && player.win_by_number !== undefined && player.win_by_number > 0) {
                        roleEmbed.addFields({
                            name: '🎯 Win Condition',
                            value: `You need to achieve **${player.win_by_number}** to win.`,
                            inline: true
                        });
                    }

                    // Send the role notification to the journal
                    await journalChannel.send({
                        content: `<@${player.user_id}>`,
                        embeds: [roleEmbed]
                    });

                    sent++;
                    console.log(`Sent role notification to ${player.username}: ${displayRoleName}`);

                } catch (error) {
                    console.error(`Error sending role notification to ${player.username}:`, error);
                    failed++;
                }
            }

            console.log(`[DEBUG] Wolf team: ${wolfTeam.length} players, Wolf roles not in chat: ${wolfRolesNotInChat.length} roles`);

            // Send wolf team information to wolf chat if there are wolves
            if (wolfTeam.length > 0 && game.wolf_chat_channel_id) {
                try {
                    const wolfChannel = await this.client.channels.fetch(game.wolf_chat_channel_id);
                    if (wolfChannel) {
                        // Create wolf team list message
                        const wolfTeamList = wolfTeam.map(wolf => {
                            let wolfInfo = `• **${wolf.roleName}** - ${wolf.username}`;
                            
                            // Add charges if available
                            if (wolf.charges !== null && wolf.charges !== undefined && wolf.charges > 0) {
                                wolfInfo += ` (⚡ ${wolf.charges} charges)`;
                            }
                            
                            // Add win condition if available
                            if (wolf.winByNumber !== null && wolf.winByNumber !== undefined && wolf.winByNumber > 0) {
                                wolfInfo += ` (🎯 win by ${wolf.winByNumber})`;
                            }
                            
                            return wolfInfo;
                        }).join('\n');

                        const wolfEmbed = new EmbedBuilder()
                            .setTitle('🐺 Wolf Team')
                            .setDescription(`Hope you wanted to be a wolf! Here are your fellow wolves:\n\n${wolfTeamList}`)
                            .setColor(0xE74C3C)
                            .setTimestamp();

                        await wolfChannel.send({ embeds: [wolfEmbed] });

                        // If there are wolf roles not in chat, alert the team
                        if (wolfRolesNotInChat.length > 0) {
                            const notInChatList = wolfRolesNotInChat.map(role => {
                                let roleInfo = `• **${role.roleName}**`;
                                
                                // Add charges if available
                                if (role.charges !== null && role.charges !== undefined && role.charges > 0) {
                                    roleInfo += ` (⚡ ${role.charges} charges)`;
                                }
                                
                                // Add win condition if available
                                if (role.winByNumber !== null && role.winByNumber !== undefined && role.winByNumber > 0) {
                                    roleInfo += ` (🎯 win by ${role.winByNumber})`;
                                }
                                
                                return roleInfo;
                            }).join('\n');

                            const alertEmbed = new EmbedBuilder()
                                .setTitle('⚠️ Major Wolf Alert!')
                                .setDescription(`You appear to have some helpers working in the shadows:\n\n${notInChatList}`)
                                .setColor(0xF39C12)
                                .setTimestamp();

                            await wolfChannel.send({ embeds: [alertEmbed] });
                        }
                    }
                } catch (error) {
                    console.error('Error sending wolf team message to wolf chat:', error);
                }
            }

        } catch (error) {
            console.error('Error in sendRoleNotificationsToJournals:', error);
        }

        return { sent, failed, wolvesAddedToChat };
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
                        ARRAY_AGG(p2.username) as voters
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
                    const voters = row.voters.map(voter => `- ${voter}`).join('\n');
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

    /**
     * Ensure a user has a journal, create one if they don't
     * This is a helper function used by handleSignUp to automatically create journals
     */
    async ensureUserHasJournal(message, user) {
        const serverId = message.guild.id;
        
        try {
            // Check if user already has a journal
            const existingJournal = await this.db.query(
                'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
                [serverId, user.id]
            );

            if (existingJournal.rows.length > 0) {
                // User already has a journal, verify the channel still exists
                const journalChannel = await this.client.channels.fetch(existingJournal.rows[0].channel_id).catch(() => null);
                if (journalChannel) {
                    return; // Journal exists and channel is valid
                }
                // Channel doesn't exist, we'll create a new one
            }

            // Get the user's member object
            const targetMember = await message.guild.members.fetch(user.id).catch(() => null);
            if (!targetMember) {
                console.error(`Could not fetch member ${user.tag} for journal creation`);
                return;
            }

            // Proactively check if we need to split journals before creating a new one
            const splitPerformed = await this.checkAndProactivelySplitJournals(message.guild);
            
            // Get active game for category positioning
            const gameResult = await this.db.query(
                'SELECT * FROM games WHERE server_id = $1 ORDER BY game_number DESC LIMIT 1',
                [serverId]
            );

            // Find the appropriate journal category for this user (may have changed after split)
            let targetCategory = await this.findAppropriateJournalCategory(message.guild, targetMember.displayName);

            if (!targetCategory) {
                // Create the main Journals category if no categories exist
                targetCategory = await message.guild.channels.create({
                    name: 'Journals',
                    type: ChannelType.GuildCategory,
                });

                // Position it under the current game but above other games
                if (gameResult.rows.length > 0) {
                    try {
                        const currentGameCategory = await this.client.channels.fetch(gameResult.rows[0].category_id);
                        if (currentGameCategory) {
                            const targetPosition = currentGameCategory.position + 1;
                            await targetCategory.setPosition(targetPosition);
                            console.log(`Positioned Journals category at position ${targetPosition}`);
                        }
                    } catch (error) {
                        console.error('Error positioning Journals category:', error);
                    }
                }
            }

            // Create journal channel name
            const journalChannelName = `${targetMember.displayName.toLowerCase().replace(/\s+/g, '-')}-journal`;

            // Check if journal already exists
            const existingJournalChannel = message.guild.channels.cache.find(
                channel => channel.name === journalChannelName && channel.parent?.id === targetCategory.id
            );

            if (existingJournalChannel) {
                // Update database to link existing channel to user
                await this.db.query(
                    `INSERT INTO player_journals (server_id, user_id, channel_id) 
                     VALUES ($1, $2, $3) 
                     ON CONFLICT (server_id, user_id) 
                     DO UPDATE SET channel_id = $3, created_at = CURRENT_TIMESTAMP`,
                    [serverId, user.id, existingJournalChannel.id]
                );
                return;
            }

            // Get roles for permissions
            const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');
            const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
            const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');

            // Create the journal channel with proper permissions
            const journalChannel = await message.guild.channels.create({
                name: journalChannelName,
                type: ChannelType.GuildText,
                parent: targetCategory.id,
                permissionOverwrites: [
                    {
                        id: message.guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: user.id,
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
                [serverId, user.id, journalChannel.id]
            );

            console.log(`📔 Auto-created journal for ${targetMember.displayName} (${user.id})`);

            // After creating the journal, alphabetize it within its category and check if we need to rebalance
            await this.alphabetizeJournalsInCategory(message.guild, targetCategory);
            await this.checkAndRebalanceJournals(message.guild);

        } catch (error) {
            console.error('Error ensuring user has journal:', error);
            // Don't throw error to avoid breaking the signup process
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
    }

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
    }

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
    }

    async handleReaction(reaction, user) {
        try {
            // Check if this is a speed vote message
            const speedVote = await this.db.query(
                'SELECT * FROM game_speed WHERE message_id = $1',
                [reaction.message.id]
            );

            if (speedVote.rows.length === 0) return;

            const speedData = speedVote.rows[0];
            const customEmoji = speedData.emoji || '⚡'; // Use stored emoji or default to lightning bolt

            // Only handle reactions with the custom emoji for this speed vote
            let isCorrectEmoji = false;
            if (customEmoji.startsWith('<:') && customEmoji.endsWith('>')) {
                // Custom emoji format: <:name:id>
                const emojiId = customEmoji.match(/:(\d+)>/)?.[1];
                if (emojiId && reaction.emoji.id === emojiId) {
                    isCorrectEmoji = true;
                }
            } else {
                // Unicode emoji
                if (reaction.emoji.name === customEmoji || reaction.emoji.toString() === customEmoji) {
                    isCorrectEmoji = true;
                }
            }
            
            if (!isCorrectEmoji) return;

            // Check if the user has the "Alive" role
            const guild = reaction.message.guild;
            const member = await guild.members.fetch(user.id).catch(() => null);
            
            if (!member) {
                console.log(`Could not fetch member ${user.tag} for reaction check`);
                return;
            }

            const aliveRole = guild.roles.cache.find(r => r.name === 'Alive');
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
                        [guild.id, 'active']
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
    }

    async alphabetizeJournalsInCategory(guild, category) {
        if (!category || category.children?.cache.size === 0) return;

        const journalChannels = category.children.cache.filter(
            channel => channel.name.endsWith('-journal')
        );

        if (journalChannels.size === 0) return;

        // Sort journals alphabetically
        const sortedJournals = journalChannels.sort((a, b) => {
            const nameA = a.name.replace('-journal', '').toLowerCase();
            const nameB = b.name.replace('-journal', '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Move journals to their correct positions
        let position = 0;
        for (const journal of sortedJournals.values()) {
            if (journal.position !== position) {
                await journal.setPosition(position);
            }
            position++;
        }
    }



    /**
     * Find the appropriate journal category for a new journal based on alphabetical order
     */
    async findAppropriateJournalCategory(guild, displayName) {
        try {
            // Get all journal categories
            const journalCategories = guild.channels.cache.filter(
                channel => channel.type === ChannelType.GuildCategory && 
                (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
            );

            if (journalCategories.size === 0) {
                return null; // No categories exist yet
            }

            // Get all journal channels from all categories
            const allJournalChannels = [];
            for (const category of journalCategories.values()) {
                const categoryChannels = guild.channels.cache.filter(
                    channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
                );
                allJournalChannels.push(...categoryChannels.values());
            }

            // If we have less than 50 journals total, use the main Journals category
            if (allJournalChannels.length < 50) {
                return journalCategories.find(cat => cat.name === 'Journals');
            }

            // Sort all journals alphabetically
            allJournalChannels.sort((a, b) => {
                const nameA = a.name.replace('-journal', '').toLowerCase();
                const nameB = b.name.replace('-journal', '').toLowerCase();
                return nameA.localeCompare(nameB);
            });

            // Find where the new journal would fit alphabetically
            const newJournalName = displayName.toLowerCase().replace(/\s+/g, '-');
            let insertIndex = 0;
            for (let i = 0; i < allJournalChannels.length; i++) {
                const existingName = allJournalChannels[i].name.replace('-journal', '').toLowerCase();
                if (newJournalName.localeCompare(existingName) > 0) {
                    insertIndex = i + 1;
                } else {
                    break;
                }
            }

            // Calculate which category this journal would belong to
            const maxChannelsPerCategory = 50;
            const numCategoriesNeeded = Math.max(2, Math.ceil((allJournalChannels.length + 1) / maxChannelsPerCategory));
            const journalsPerCategory = Math.ceil((allJournalChannels.length + 1) / numCategoriesNeeded);
            const targetCategoryIndex = Math.floor(insertIndex / journalsPerCategory);

            // Find the appropriate category
            if (targetCategoryIndex === 0) {
                // First category - could be "Journals" or "Journals (A-L)"
                const firstCategory = journalCategories.find(cat => 
                    cat.name === 'Journals' || cat.name.startsWith('Journals (A-')
                );
                return firstCategory;
            } else {
                // Find category by index
                const sortedCategories = journalCategories.sort((a, b) => {
                    const aName = a.name;
                    const bName = b.name;
                    return aName.localeCompare(bName);
                });
                
                if (targetCategoryIndex < sortedCategories.size) {
                    return sortedCategories.at(targetCategoryIndex);
                }
            }

            // Fallback to main Journals category
            return journalCategories.find(cat => cat.name === 'Journals');

        } catch (error) {
            console.error('Error finding appropriate journal category:', error);
            // Fallback to main Journals category
            return guild.channels.cache.find(
                channel => channel.type === ChannelType.GuildCategory && channel.name === 'Journals'
            );
        }
    }

    /**
     * Proactively check if we're approaching the journal threshold and split if needed
     * This is called before creating new journals to prevent hitting the 50-channel limit
     */
    async checkAndProactivelySplitJournals(guild, message = null) {
        try {
            // Get all journal categories
            const journalCategories = guild.channels.cache.filter(
                channel => channel.type === ChannelType.GuildCategory && 
                (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
            );

            if (journalCategories.size === 0) {
                return false; // No journal categories exist yet
            }

            // Get all journal channels from all categories
            const allJournalChannels = [];
            for (const category of journalCategories.values()) {
                const categoryChannels = guild.channels.cache.filter(
                    channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
                );
                allJournalChannels.push(...categoryChannels.values());
            }

            const totalJournals = allJournalChannels.length;
            const maxChannelsPerCategory = 50;
            const thresholdForSplitting = 49; // Split when we're about to hit the limit

            // Check if we're approaching the threshold
            if (totalJournals >= thresholdForSplitting) {
                // Calculate how many categories we'll need after adding one more journal
                const futureTotalJournals = totalJournals + 1;
                const numCategoriesNeeded = futureTotalJournals >= maxChannelsPerCategory ? Math.max(2, Math.ceil(futureTotalJournals / maxChannelsPerCategory)) : 1;
                
                // Check if we need to split (if we'll have more categories than we currently do)
                const currentNumCategories = journalCategories.size;
                
                if (numCategoriesNeeded > currentNumCategories) {
                    // We need to split! Alert the user and proceed
                    if (message) {
                        const alertEmbed = new EmbedBuilder()
                            .setTitle('⚠️ Journal Split Incoming')
                            .setDescription(`We're approaching the Discord channel limit (${totalJournals}/50 journals).\n\n**Splitting journals into ${numCategoriesNeeded} categories to maintain organization...**\n\nThis will take a moment. Please wait.`)
                            .addFields(
                                { name: 'Current Journals', value: totalJournals.toString(), inline: true },
                                { name: 'New Categories', value: numCategoriesNeeded.toString(), inline: true }
                            )
                            .setColor(0xFFA500)
                            .setTimestamp();

                        await message.reply({ embeds: [alertEmbed] });
                    }

                    console.log(`⚠️ Proactively splitting ${totalJournals} journals into ${numCategoriesNeeded} categories to prevent hitting Discord limit...`);
                    
                    // Perform the split using the existing rebalancing logic
                    await this.performJournalRebalancing(guild, allJournalChannels, journalCategories);
                    
                    return true; // Split was performed
                }
            }

            return false; // No split needed
        } catch (error) {
            console.error('Error in checkAndProactivelySplitJournals:', error);
            return false;
        }
    }

    /**
     * Perform the actual journal rebalancing operation
     * This is extracted from checkAndRebalanceJournals to be reusable
     */
    async performJournalRebalancing(guild, allJournalChannels, journalCategories) {
        // Sort journals alphabetically
        allJournalChannels.sort((a, b) => {
            const nameA = a.name.replace('-journal', '').toLowerCase();
            const nameB = b.name.replace('-journal', '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        const totalJournals = allJournalChannels.length;
        const maxChannelsPerCategory = 50;

        // If we have less than 50 journals, just alphabetize in current structure
        if (totalJournals < maxChannelsPerCategory) {
            // Find the main Journals category
            const mainCategory = journalCategories.find(cat => cat.name === 'Journals');
            if (mainCategory) {
                await this.alphabetizeJournalsInCategory(guild, mainCategory);
            }
            return;
        }

        // We need to split into multiple categories (50+ journals, including exactly 50)
        // For exactly 50 journals, we split into 2 categories of 25 each
        const numCategoriesNeeded = totalJournals >= maxChannelsPerCategory ? Math.max(2, Math.ceil(totalJournals / maxChannelsPerCategory)) : 1;
        const journalsPerCategory = Math.ceil(totalJournals / numCategoriesNeeded);

        // Check if we need to rebalance (if any category has more than the target number)
        let needsRebalancing = false;
        for (const category of journalCategories.values()) {
            const categoryChannels = guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            if (categoryChannels.size > journalsPerCategory) {
                needsRebalancing = true;
                break;
            }
        }

        // If any category is over the limit, we need to rebalance
        for (const category of journalCategories.values()) {
            const categoryChannels = guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            if (categoryChannels.size > maxChannelsPerCategory) {
                needsRebalancing = true;
                break;
            }
        }

        if (!needsRebalancing) {
            return; // No rebalancing needed
        }

        console.log(`🔄 Rebalancing ${totalJournals} journals into ${numCategoriesNeeded} categories...`);

        // Handle category creation/renaming for proper alphabetical order
        const newCategories = [];
        
        // Find the original "Journals" category
        const originalJournalsCategory = guild.channels.cache.find(
            channel => channel.type === ChannelType.GuildCategory && channel.name === 'Journals'
        );
        
        for (let i = 0; i < numCategoriesNeeded; i++) {
            const startIndex = i * journalsPerCategory;
            const endIndex = Math.min((i + 1) * journalsPerCategory, totalJournals);
            const startJournal = allJournalChannels[startIndex];
            const endJournal = allJournalChannels[endIndex - 1];
            
            // Extract display names for category naming
            const startName = startJournal.name.replace('-journal', '').toUpperCase();
            const endName = endJournal.name.replace('-journal', '').toUpperCase();
            
            // Get first letter of start and last letter of end
            const startLetter = startName.charAt(0);
            const endLetter = endName.charAt(0);
            
            const categoryName = `Journals (${startLetter}-${endLetter})`;
            
            let category;
            
            if (i === 0 && originalJournalsCategory) {
                // For the first category, rename the existing "Journals" category
                await originalJournalsCategory.setName(categoryName);
                category = originalJournalsCategory;
                console.log(`📝 Renamed "Journals" to "${categoryName}"`);
            } else {
                // For subsequent categories, create new ones
                category = guild.channels.cache.find(
                    channel => channel.type === ChannelType.GuildCategory && channel.name === categoryName
                );
                
                if (!category) {
                    // Create new category
                    category = await guild.channels.create({
                        name: categoryName,
                        type: ChannelType.GuildCategory,
                    });
                    
                    // Position it after the previous category (which is now properly named)
                    if (i > 0 && newCategories[i - 1]) {
                        await category.setPosition(newCategories[i - 1].position + 1);
                    }
                }
            }
            
            newCategories.push(category);
        }

        // Move journals to their appropriate categories
        let movedCount = 0;
        const movedJournals = []; // Track moved journals and their original permissions
        
        for (let i = 0; i < numCategoriesNeeded; i++) {
            const startIndex = i * journalsPerCategory;
            const endIndex = Math.min((i + 1) * journalsPerCategory, totalJournals);
            const categoryJournals = allJournalChannels.slice(startIndex, endIndex);
            
            for (const journal of categoryJournals) {
                if (journal.parent?.id !== newCategories[i].id) {
                    // Store current permission overrides before moving the channel
                    const currentPermissions = journal.permissionOverwrites.cache;
                    
                    // Move the channel to the new category
                    await journal.setParent(newCategories[i].id);
                    movedCount++;
                    
                    // Store the journal and its permissions for later restoration
                    movedJournals.push({
                        journal: journal,
                        permissions: currentPermissions,
                        targetCategory: newCategories[i]
                    });
                    
                    console.log(`Moved journal "${journal.name}" to category "${newCategories[i].name}"`);
                }
            }
        }
        
        // Now wait for Discord to process all the moves, then restore permissions
        if (movedJournals.length > 0) {
            console.log(`Waiting for Discord to process ${movedJournals.length} journal moves...`);
            
            // Poll for all moves to be recognized
            let allMovesConfirmed = false;
            let attempts = 0;
            const maxAttempts = 15; // 15 seconds total
            
            while (!allMovesConfirmed && attempts < maxAttempts) {
                // Wait 1 second before checking
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Refresh the Discord cache
                await guild.channels.fetch();
                
                // Check if all moves have been processed
                allMovesConfirmed = true;
                for (const movedJournal of movedJournals) {
                    const refreshedJournal = guild.channels.cache.get(movedJournal.journal.id);
                    if (!refreshedJournal || refreshedJournal.parent?.id !== movedJournal.targetCategory.id) {
                        allMovesConfirmed = false;
                        break;
                    }
                }
                
                attempts++;
                if (!allMovesConfirmed) {
                    console.log(`⏳ Waiting for Discord to process journal moves... (attempt ${attempts}/${maxAttempts})`);
                }
            }
            
            if (allMovesConfirmed) {
                console.log(`✅ All journal moves confirmed, restoring permissions...`);
                
                // Now restore permissions for all moved journals using fresh references
                for (const movedJournal of movedJournals) {
                    try {
                        // Get a fresh reference to the channel after the move
                        const freshJournal = guild.channels.cache.get(movedJournal.journal.id);
                        if (!freshJournal) {
                            console.warn(`⚠️ Could not find fresh reference for journal ${movedJournal.journal.name}`);
                            continue;
                        }
                        
                        for (const [id, permission] of movedJournal.permissions) {
                            const permissionData = {};
                            
                            // Check each permission flag and set it appropriately
                            const permissions = [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.AttachFiles,
                                PermissionFlagsBits.EmbedLinks,
                                PermissionFlagsBits.UseExternalEmojis,
                                PermissionFlagsBits.AddReactions
                            ];
                            
                            for (const perm of permissions) {
                                if (permission.allow.has(perm)) {
                                    permissionData[perm] = true;
                                } else if (permission.deny.has(perm)) {
                                    permissionData[perm] = false;
                                }
                                // If neither allow nor deny, don't set the permission (inherits from category)
                            }
                            
                            if (Object.keys(permissionData).length > 0) {
                                await freshJournal.permissionOverwrites.edit(id, permissionData);
                            }
                        }
                        console.log(`✅ Restored permissions for journal channel: ${movedJournal.journal.name}`);
                    } catch (permissionError) {
                        console.error(`⚠️ Warning: Could not restore permissions for journal channel ${movedJournal.journal.name}:`, permissionError);
                    }
                }
            } else {
                console.warn(`⚠️ Not all journal moves were confirmed after ${maxAttempts} attempts`);
            }
        }
        
        // Alphabetize journals within each category
        for (let i = 0; i < numCategoriesNeeded; i++) {
            await this.alphabetizeJournalsInCategory(guild, newCategories[i]);
        }

        // Clean up old empty categories (except the original 'Journals' category)
        for (const category of journalCategories.values()) {
            if (category.name !== 'Journals' && category.children?.cache.size === 0) {
                await category.delete();
            }
        }

        console.log(`✅ Rebalanced ${totalJournals} journals: moved ${movedCount} journals into ${numCategoriesNeeded} categories`);
    }

    /**
     * Check if journals need rebalancing and automatically rebalance if needed
     * This is called after creating new journals to maintain optimal distribution
     */
    async checkAndRebalanceJournals(guild) {
        try {
            // Get all journal categories
            const journalCategories = guild.channels.cache.filter(
                channel => channel.type === ChannelType.GuildCategory && 
                (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
            );

            if (journalCategories.size === 0) {
                return; // No journal categories exist yet
            }

            // Get all journal channels from all categories
            const allJournalChannels = [];
            for (const category of journalCategories.values()) {
                const categoryChannels = guild.channels.cache.filter(
                    channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
                );
                allJournalChannels.push(...categoryChannels.values());
            }

            if (allJournalChannels.length === 0) {
                return; // No journal channels exist
            }

            // Use the extracted rebalancing logic
            await this.performJournalRebalancing(guild, allJournalChannels, journalCategories);

        } catch (error) {
            console.error('Error in checkAndRebalanceJournals:', error);
            // Don't throw error to avoid breaking journal creation
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

    /**
     * Handle archive local command - saves game data as JSON file locally (development only)
     */
    /**
     * Handle manual sync members command
     */
    /**
     * Handle role configuration command
     */
    /**
     * Sync all server members to the database for archive purposes
     * This method fetches all members from all servers the bot is in
     * and stores their user_id and display_name in the server_users table
     */
    async syncServerMembers() {
        try {
            console.log('🔄 Starting daily server member sync...');
            
            let totalMembersProcessed = 0;
            let totalServersProcessed = 0;
            
            // Iterate through all guilds the bot is in
            for (const [guildId, guild] of this.client.guilds.cache) {
                try {
                    console.log(`📊 Processing guild: ${guild.name} (${guild.id})`);
                    
                    // Fetch all members for this guild
                    await guild.members.fetch();
                    
                    let membersProcessed = 0;
                    
                    // Process each member
                    for (const [memberId, member] of guild.members.cache) {
                        try {
                            // Skip bot users
                            if (member.user.bot) continue;
                            
                            // Get display name (nickname if set, otherwise username)
                            const displayName = member.displayName || member.user.username;
                            
                            // Get profile picture URL
                            const profilePictureUrl = member.user.displayAvatarURL({ format: 'png', size: 256 });
                            
                            // Upsert member data to database
                            const query = `
                                INSERT INTO server_users (user_id, server_id, display_name, profile_picture_link)
                                VALUES ($1, $2, $3, $4)
                                ON CONFLICT (user_id, server_id) 
                                DO UPDATE SET display_name = $3, profile_picture_link = $4
                            `;
                            
                            await this.db.query(query, [
                                member.user.id,
                                guild.id,
                                displayName,
                                profilePictureUrl
                            ]);
                            
                            membersProcessed++;
                            
                        } catch (memberError) {
                            console.error(`Error processing member ${member.user.tag} in guild ${guild.name}:`, memberError);
                        }
                    }
                    
                    console.log(`✅ Processed ${membersProcessed} members in guild: ${guild.name}`);
                    totalMembersProcessed += membersProcessed;
                    totalServersProcessed++;
                    
                    // Rate limiting between guilds to avoid Discord API limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (guildError) {
                    console.error(`Error processing guild ${guild.name} (${guild.id}):`, guildError);
                }
            }
            
            console.log(`🎉 Daily member sync complete! Processed ${totalMembersProcessed} members across ${totalServersProcessed} servers`);
            
            // Log summary to a designated channel if configured
            if (process.env.MEMBER_SYNC_LOG_CHANNEL_ID) {
                try {
                    const logChannel = this.client.channels.cache.get(process.env.MEMBER_SYNC_LOG_CHANNEL_ID);
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle('📊 Daily Member Sync Complete')
                            .setDescription('Server member data has been updated for archive purposes')
                            .addFields(
                                { name: 'Servers Processed', value: totalServersProcessed.toString(), inline: true },
                                { name: 'Members Processed', value: totalMembersProcessed.toString(), inline: true },
                                { name: 'Timestamp', value: new Date().toISOString(), inline: true }
                            )
                            .setColor(0x00AE86)
                            .setTimestamp();
                        
                        await logChannel.send({ embeds: [embed] });
                    }
                } catch (logError) {
                    console.error('Error sending sync log message:', logError);
                }
            }
            
        } catch (error) {
            console.error('❌ Error during daily member sync:', error);
        }
    }

    async setChannelPermissions(game, aliveRole, allowMessages, message) {
        const channels = [];
        
        // Add townsquare channel
        if (game.town_square_channel_id) {
            channels.push(game.town_square_channel_id);
        }
        
        // Add memos channel
        if (game.memos_channel_id) {
            channels.push(game.memos_channel_id);
        }

        // Update permissions for each channel
        for (const channelId of channels) {
            try {
                const channel = await this.client.channels.fetch(channelId);
                if (channel) {
                    await channel.permissionOverwrites.edit(aliveRole.id, {
                        ViewChannel: true,
                        SendMessages: allowMessages
                    });
                    console.log(`Updated ${channel.name} permissions: Alive role can send messages = ${allowMessages}`);
                }
            } catch (error) {
                console.error(`Error updating permissions for channel ${channelId}:`, error);
            }
        }
    }

}

module.exports = WerewolfBot;
