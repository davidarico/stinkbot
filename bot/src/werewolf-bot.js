const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const moment = require('moment-timezone');
const OpenAI = require('openai');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Client } = require('@opensearch-project/opensearch');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

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
    }

    /**
     * Discord servers have a hard limit of 500 channels.
     * This helper computes current guild channel usage + any channels queued to be created
     * (tracked in DB via game_channels.is_created=false for the most recent signup/active game).
     */
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
    }

    /**
     * Download an image from a URL and return the buffer
     * Note: Images are stored in memory only, not saved to disk
     */
    async downloadImage(url) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;
            
            const request = protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download image: ${response.statusCode}`));
                    return;
                }

                const chunks = [];
                response.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                response.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve(buffer);
                });
            });

            request.on('error', (error) => {
                reject(error);
            });

            request.setTimeout(30000, () => {
                request.destroy();
                reject(new Error('Download timeout'));
            });
        });
    }

    /**
     * Upload an image buffer to S3 and return the public URL
     * Note: Images are uploaded directly from memory, no temporary files created
     */
    async uploadImageToS3(imageBuffer, originalUrl, messageId, imageIndex = 0) {
        if (!this.s3Client) {
            throw new Error('S3 client not configured');
        }

        try {
            // Use the specific bucket for images
            const imageBucketName = 'stinkwolf-images';
            
            // Generate filename using message ID and index to handle multiple images per message
            const extension = this.getImageExtension(originalUrl);
            const filename = imageIndex === 0 
                ? `discord-images/${messageId}${extension}`
                : `discord-images/${messageId}_${imageIndex}${extension}`;

            const uploadParams = {
                Bucket: imageBucketName,
                Key: filename,
                Body: imageBuffer,
                ContentType: this.getContentType(extension)
            };

            await this.s3Client.send(new PutObjectCommand(uploadParams));
            
            // Return the public S3 URL
            return `https://${imageBucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
        } catch (error) {
            console.error('Error uploading image to S3:', error);
            throw error;
        }
    }

    /**
     * Get file extension from URL
     */
    getImageExtension(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const extension = pathname.split('.').pop().toLowerCase();
            
            // Validate extension is an image
            const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
            if (validExtensions.includes(extension)) {
                return `.${extension}`;
            }
            
            // Default to .jpg if no valid extension found
            return '.jpg';
        } catch (error) {
            return '.jpg';
        }
    }

    /**
     * Get content type based on file extension
     */
    getContentType(extension) {
        const contentTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp'
        };
        return contentTypes[extension] || 'image/jpeg';
    }

    /**
     * Process Discord image URLs in message content and replace with S3 URLs
     */
    async processDiscordImages(messageContent, messageId) {
        if (!this.s3Client) {
            return messageContent; // Return original content if S3 not configured
        }

        // Regex to match Discord CDN URLs (including query parameters)
        const discordImageRegex = /https:\/\/cdn\.discordapp\.com\/attachments\/\d+\/\d+\/[^\s]+/g;
        const matches = messageContent.match(discordImageRegex);
        
        if (!matches) {
            return messageContent;
        }

        let processedContent = messageContent;
        let imageIndex = 0;
        
        for (const imageUrl of matches) {
            let imageBuffer = null;
            try {
                console.log(`Processing Discord image: ${imageUrl}`);
                
                // Download the image to memory (no disk storage)
                imageBuffer = await this.downloadImage(imageUrl);
                
                // Upload to S3
                const s3Url = await this.uploadImageToS3(imageBuffer, imageUrl, messageId, imageIndex);
                
                // Replace the Discord URL with S3 URL
                processedContent = processedContent.replace(imageUrl, s3Url);
                
                imageIndex++;
                
                console.log(`Successfully processed image: ${imageUrl} -> ${s3Url}`);
                
                // Add a small delay to avoid overwhelming the APIs
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Failed to process image ${imageUrl}:`, error);
                // Keep the original URL if processing fails
            } finally {
                // Explicitly clear the buffer from memory
                if (imageBuffer) {
                    imageBuffer = null;
                }
            }
        }
        
        return processedContent;
    }

    async generateFunnyResponse(command, username) {
        if (!this.openai) {
            return null;
        }

        try {
            const prompt = `You are a Discord bot for a Werewolf (mafia) game. A user tried to use an unknown command: "${command}". 
                Generate a funny, short response (1-2 sentences max) that:
                - Is playful and slightly sarcastic
                - Is a possible response to the command
                - Keeps the tone light and entertaining
                - Doesn't exceed 2 sentences
                - Crass and vulgar language is allowed

                Do not allude to the fact that the command is unknown.
            `;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a sassy Discord bot that responds to unknown commands with short, funny messages that could be a possible response to the command.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 100,
                temperature: 0.8
            });

            const content = response.choices[0]?.message?.content?.trim() || null;
            if (!content) return null;
            
            // Remove extra quotes from the beginning and end of the response
            let cleanedContent = content;
            
            // Remove quotes from the beginning
            while (cleanedContent.startsWith('"') || cleanedContent.startsWith('"') || cleanedContent.startsWith("'") || cleanedContent.startsWith("'")) {
                cleanedContent = cleanedContent.slice(1);
            }
            
            // Remove quotes from the end
            while (cleanedContent.endsWith('"') || cleanedContent.endsWith('"') || cleanedContent.endsWith("'") || cleanedContent.endsWith("'")) {
                cleanedContent = cleanedContent.slice(0, -1);
            }
            
            return cleanedContent;
        } catch (error) {
            console.error('Error generating OpenAI response:', error);
            return null;
        }
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
        const playerCommands = ['in', 'out', 'vote', 'retract', 'alive', 'peed', 'help', 'meme', 'wolf_list', 'mylo', 'feedback', 'my_journal', 'players'];
        const superUserCommands = ['mod', 'unmod'];
        
        // Check permissions for admin-only commands
        if (superUserCommands.includes(command)) {
            const allowed = await this.isSuperUser(message.author?.id);
            if (!allowed) {
                await message.reply('❌ You do not have permission to use this command.');
                return;
            }
        } else if (!playerCommands.includes(command) && !this.hasModeratorPermissions(message.member)) {
            const funnyResponse = await this.generateFunnyResponse(message.content.slice(prefix.length).trim().split(/ +/), message.author.displayName);
            if (funnyResponse) {
                await message.reply(funnyResponse);
            } else {
                await message.reply('❓ Unknown command bozo. (Or you fuckers used up all the tokens)');
            }
            return;
        }

        try {
            switch (command) {
                case 'mod':
                    await this.handleMod(message, args);
                    break;
                case 'unmod':
                    await this.handleUnmod(message, args);
                    break;
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
                    await this.handleStart(message, args);
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
                case 'dead':
                    await this.handleDead(message);
                    break;
                // <fletch> helpful for making memos after some players have died without manually grabbing dead names
                case 'players':
                    await this.handleAlive(message, true);
                    break;
                // Mod utility which simply removes "Alive" and adds "Dead" from a player
                case 'kill':
                    await this.killPlayer(message)
                    break;
                // </fletch>
                case 'inlist':
                    await this.handleInList(message, args);
                    break;
                case 'signups':
                    await this.handleSignups(message, args);
                    break;
                case 'add_channel':
                    await this.handleAddChannel(message, args);
                    break;
                case 'todo':
                    await this.handleTodo(message);
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
                case 'journal_grant_pin':
                    await this.handleJournalPinPerms(message);
                    break;
                case 'fix_journals':
                    await this.handleFixJournals(message);
                    break;
                case 'server':
                    await this.handleServer(message);
                    break;
                case 'roles_list':
                    await this.handleRolesList(message);
                    break;
                case 'my_journal':
                    await this.handleMyJournal(message);
                    break;
                case 'balance_journals':
                    await this.handleBalanceJournals(message);
                    break;
                case 'populate_journals':
                    await this.handlePopulateJournals(message, args);
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
                case 'archive':
                    await this.handleArchive(message, args);
                    break;
                case 'archive_local':
                    await this.handleArchiveLocal(message, args);
                    break;
                case 'sync_members':
                    await this.handleSyncMembers(message);
                    break;
                case 'role_config':
                    await this.handleRoleConfiguration(message);
                    break;
                case 'channel_config':
                    await this.handleChannelConfig(message);
                    break;
                case 'feedback':
                    await this.handleFeedback(message, args);
                    break;
                case 'set_voting_booth':
                    await this.handleSetVotingBooth(message, args);
                    break;

                // Meme commands
                case 'meme':
                    await this.handleMeme(message);
                    break;
                case 'peed':
                    await message.reply('💦 IM PISSING REALLY HARD AND ITS REALLY COOL 💦');
                    break;
                case 'mylo':
                    await message.reply('Mylo can maybe backpedal to Orphan if we need to if this doesn\'t land');
                    break;
                case 'wolf_list':
                    await message.reply('The wolf list? Are we still doing this? Stop talking about the wolf list.');
                    break;
                case 'lockdown':
                    await this.handleLockdown(message, args);
                    break;
                case 'perms_test':
                    await this.permsTest(message, args);
                    break;
                case 'scuff':
                    await this.handleScuff(message);
                    break;
                case 'delete_category':
                    await this.handleDeleteCategory(message, args);
                    break;
                default:
                    const funnyResponse = await this.generateFunnyResponse(message.content.slice(prefix.length).trim().split(/ +/), message.author.displayName);
                    if (funnyResponse) {
                        await message.reply(funnyResponse);
                    } else {
                        await message.reply('❓ Unknown command bozo. (Or you fuckers used up all the tokens)');
                    }
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await message.reply('❌ An error occurred while processing your command.');
        }
    }

    async isSuperUser(userId) {
        if (!userId) return false;
        try {
            const result = await this.db.query(
                'SELECT 1 FROM super_users WHERE user_id = $1 LIMIT 1',
                [userId]
            );
            return result.rows.length > 0;
        } catch (error) {
            console.error('Error checking super user status:', error);
            return false;
        }
    }

    hasModeratorPermissions(member) {
        return member.permissions.has(PermissionFlagsBits.ManageChannels) || 
               member.permissions.has(PermissionFlagsBits.Administrator);
    }

    async handleMod(message, args) {
        const targetMember = message.mentions?.members?.first?.() || null;
        if (!targetMember) {
            await message.reply(`❌ Usage: ${this.prefix}mod @user`);
            return;
        }

        await this.assignRole(targetMember, 'Mod');
        await message.reply(`✅ Granted **Mod** to ${targetMember}.`);
    }

    async handleUnmod(message, args) {
        const targetMember = message.mentions?.members?.first?.() || null;
        if (!targetMember) {
            await message.reply(`❌ Usage: ${this.prefix}unmod @user`);
            return;
        }

        await this.removeRole(targetMember, 'Mod');
        await message.reply(`✅ Removed **Mod** from ${targetMember}.`);
    }

    isPublicChannel(message) {
        const channelName = message.channel.name.toLowerCase();
        return !channelName.includes('dead-chat') && !channelName.includes('mod-chat');
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
                // For killPlayer to determine if player was actually alive
                return true;
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
    }

    async handleSignUp(message) {
        const serverId = message.guild.id;
        const user = message.author;

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

        // Check if signups are closed
        if (game.signups_closed) {
            return message.reply('Sorry there is no way to get off Mr. Bones\' Wild Ride (Message a mod if you would really like to get out)');
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

        // Check if there are players
        const playersResult = await this.db.query(
            'SELECT COUNT(*) as count FROM players WHERE game_id = $1',
            [game.id]
        );

        if (parseInt(playersResult.rows[0].count) == 0) {
            return message.reply('❌ Need at least one player to start the game.');
        }

        // Capacity check (Wolf.start will create core channels: results, memos, townsquare, voting-booth, wolf-chat)
        // Plus any DB-queued channels tracked as game_channels.is_created=false (counted in getServerChannelCapacity)
        const plannedNewChannels = 5;
        const capacity = await this.getServerChannelCapacity(serverId, message.guild, plannedNewChannels);
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
        await results.setPosition(signupChannel.position); // Position results above the signup channel

        // 3. Player-memos - Alive can see and type (unless dark mode), Dead can see but not type, Spectators can see but not type, Mods can see and type
        const memos = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-player-memos`,
            type: ChannelType.GuildText,
            parent: category.id,
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
        await memos.setPosition(results.position + 1); // Position memos below results

        // 4. Townsquare - Alive can see and type (unless dark mode), Dead can see but not type, Spectators can see but not type, Mods can see and type
        const townSquare = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-townsquare`,
            type: ChannelType.GuildText,
            parent: category.id,
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
        await townSquare.setPosition(memos.position + 1); // Position town square below memos

        // 5. Voting-Booth (starts locked for night phase) - All can see but none can type initially (unless dark mode, then Alive cannot see)
        const votingBooth = await message.guild.channels.create({
            name: `${config.game_prefix}${game.game_number}-voting-booth`,
            type: ChannelType.GuildText,
            parent: category.id,
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
        await wolfChat.setPosition(votingBooth.position + 1); // Position wolf chat below voting booth

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
                'SELECT channel_name, day_message, night_message, invited_users FROM game_channels WHERE game_id = $1 AND is_created = $2',
                [game.id, false]
            );

            for (const channelData of pendingChannelsResult.rows) {
                try {
                    // Create the channel with the same permissions as handleAddChannel
                    const newChannel = await message.guild.channels.create({
                        name: channelData.channel_name,
                        type: ChannelType.GuildText,
                        parent: category.id,
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
                        SendMessages: channelData.open_at_dusk
                    });

                    // Position the channel between voting booth and wolf chat (same as handleAddChannel)
                    try {
                        const wolfChatChannel = category.children.cache.find(channel => 
                            channel.name.includes('-wolf-chat')
                        );
                        
                        if (wolfChatChannel) {
                            await newChannel.setPosition(wolfChatChannel.position);
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
        let wolvesAddedToChat = 0;
        let wolvesFailedToAdd = 0;
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
                        // Themed mode: show custom name with actual role in parens
                        displayRoleName = `${player.custom_name} (${player.role_name})`;
                        fullRoleDescription = `${player.custom_name} (${player.role_name})`;
                    } else if (game.is_skinned && player.custom_name) {
                        // Skinned mode: only show custom name
                        displayRoleName = player.custom_name;
                        fullRoleDescription = player.custom_name;
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
                                    } else {
                                        wolvesFailedToAdd++;
                                        console.error(`Error adding ${player.username} to wolf chat: member not found`);
                                    }
                                } else {
                                    wolvesFailedToAdd++;
                                    console.error(`Error adding ${player.username} to wolf chat: wolf channel not found`);
                                }
                            } catch (error) {
                                wolvesFailedToAdd++;
                                console.error(`Error adding ${player.username} to wolf chat:`, error);
                            }
                        } else {
                            wolvesFailedToAdd++;
                            console.error(`Error adding ${player.username} to wolf chat: wolf_chat_channel_id not set`);
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

                        const wolfTeamMessage = await wolfChannel.send({ embeds: [wolfEmbed] });
                        try {
                            await wolfTeamMessage.pin('Pin wolf team role info for easy reference');
                        } catch (error) {
                            // Pinning requires Manage Messages; don't fail the whole notification flow if it's missing.
                            console.warn('[DEBUG] Failed to pin wolf team message in wolf chat:', error?.message || error);
                        }

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

        return { sent, failed, wolvesAddedToChat, wolvesFailedToAdd };
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

        // Check if in voting booth.
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
                    
                    if (newPhase === 'day') {
                        // During day phase, check open_at_dawn flag
                        shouldAllowSendMessages = channelData.open_at_dawn;
                    } else {
                        // During night phase, check open_at_dusk flag
                        shouldAllowSendMessages = channelData.open_at_dusk;
                    }

                    // Update Alive role permissions for this channel
                    await channel.permissionOverwrites.edit(aliveRole.id, {
                        SendMessages: shouldAllowSendMessages
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
    }

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
                value: 
                    '`Wolf.in` - Sign up for the current game\n' +
                    '`Wolf.out` - Remove yourself from the current game\n' +
                    '`Wolf.vote @user` - Vote for a player (voting booth, day phase only)\n' +
                    '`Wolf.retract` - Retract your current vote\n' +
                    '`Wolf.alive` - Show all players currently alive\n' +
                    '`Wolf.players` - Show all players dead or alive\n' +
                    '`Wolf.my_journal` - 📔 Find your personal journal channel\n' +
                    '`Wolf.meme` - 😤 I dare you to try me\n' +
                    '`Wolf.help` - Show this help message\n' +
                    '`Wolf.feedback` - Submit feedback to Stinky',
                inline: false 
            }
        );

        // Super user commands (requires membership in super_users table)
        embed.addFields(
            {
                name: '🛡️ Super User Commands',
                value:
                    '`Wolf.mod @user` - Grant the Mod role to a user\n' +
                    '`Wolf.unmod @user` - Remove the Mod role from a user\n' +
                    'Requires you to be a super user',
                inline: false
            }
        );

        // Admin commands (only if user is admin) - grouped by category
        if (isAdmin) {
            embed.addFields(
                { 
                    name: '⚙️ Setup & Game Management', 
                    value: 
                        '`Wolf.setup` - Initial server setup (prefix, starting number, game name)\n' +
                        '`Wolf.server_roles` - 🎭 Create all game roles\n' +
                        '`Wolf.create` - Create a new game with signup channel\n' +
                        '`Wolf.start [dark]` - Start the game and create all channels (use `dark` to hide Townsquare, Memos, and Voting Booth from Alive role)\n' +
                        '`Wolf.settings` - View/change game and channel settings (votes_to_hang, messages)\n' +
                        '`Wolf.channel_config` - View additional channel settings\n' +
                        '`Wolf.signups [open|close]` - Open or close signups\n' +
                        '`Wolf.next` - Move to the next phase (day/night)\n' +
                        '`Wolf.end` - End the current game (requires confirmation)\n' +
                        '`Wolf.scuff` - Rewind an active game back to signup (requires confirmation)', 
                    inline: false 
                },
                { 
                    name: '🔧 Channel & Phase Management', 
                    value: 
                        '`Wolf.add_channel <n>` - Create additional channel in game category\n' +
                        '`Wolf.create_vote` - 🗳️ Manually create a voting message (voting booth only)\n' +
                        '`Wolf.get_votes` - 📊 Get current vote counts and status\n' +
                        '`Wolf.set_voting_booth <channel-name>` - 🗳️ Set voting booth channel for current game\n' +
                        '`Wolf.lockdown` - 🔒 Lock down townsquare and memos (alive players cannot speak)\n' +
                        '`Wolf.lockdown lift` - 🔓 Lift lockdown and restore normal permissions\n' +
                        '`Wolf.populate_journals [number]` - 🧪 Create test journals for testing',
                    inline: false 
                },
                { 
                    name: '📔 Journal Management', 
                    value: 
                        '`Wolf.journal @user` - Create a personal journal for a player\n' +
                        '`Wolf.journal_link` - 🔗 Link existing journals to players\n' +
                        '`Wolf.journal_owner` - 👤 Show journal owner (use in journal)\n' +
                        '`Wolf.journal_unlink` - 🔓 Unlink journal (use in journal)\n' +
                        '`Wolf.journal_assign @user` - 🎯 Assign journal to user (use in journal)\n' +
                        '`Wolf.journal_grant_pin` - 📌 Grant pin permissions for all journals\n' +
                        '`Wolf.balance_journals` - 📚 Balance journals across categories (50 channel limit)',
                    inline: false 
                },
                { 
                    name: '🎭 Role & Player Management', 
                    value: 
                        '`Wolf.roles_list` - 📋 Display all assigned roles for current game\n' +
                        '`Wolf.role_config` - ⚙️ Show role configuration for current game\n' +
                        '`Wolf.kill @player` - 🔫 Removes Alive and adds Dead role\n' +   
                        '`Wolf.inlist` - Show all players signed up (mobile-friendly format)\n' +
                        '`Wolf.dead` - 💀 Show all players currently dead', 
                    inline: false 
                },
                { 
                    name: '📊 Analysis & Utilities', 
                    value: 
                        '`Wolf.server` - 🖥️ Display detailed server information\n' +
                        '`Wolf.ia [channel] <YYYY-MM-DD HH:MM>` - Message count per player since date (EST). BOTH date and channel are optional.\n' +
                        '`Wolf.speed_check` - See messages counts since phase change',
                    inline: false 
                },
                { 
                    name: '🔄 Recovery & Maintenance', 
                    value: 
                        '`Wolf.recovery` - Migration from manual to bot control\n' +
                        '`Wolf.fix_journals` - 🔍 Fix journal permissions\n' +
                        '`Wolf.delete_category <category_name>` - 🧨 Delete a category and ALL channels inside it (requires confirmation)',
                    inline: false 
                },
                {
                    name: '🧪 Testing Commands',
                    value: 
                        '`Wolf.refresh` - Reset server (testing only!)\n' +
                        '`Wolf.archive` - Archive current game data\n' +
                        '`Wolf.archive_local` - 💾 Archive to local JSON file (dev only)\n' +
                        '`Wolf.populate_journals [number]` - 🧪 Create test journals for testing\n' +
                        '`Wolf.sync_members` - 🔄 Sync server members to database', 
                    inline: false 
                }
            );
        } else {
            embed.setFooter({ text: 'Note: Some commands are only available to moderators.' });
        }

        await message.reply({ embeds: [embed] });
    }

    async handleDeleteCategory(message, args) {
        const rawCategoryName = args.join(' ').trim();
        if (!rawCategoryName) {
            return message.reply('❌ Usage: `Wolf.delete_category <category_name>`');
        }

        let category = null;
        const allChannels = await message.guild.channels.fetch();

        // Allow passing an ID as the "name" for ambiguous cases
        if (/^\d{5,}$/.test(rawCategoryName)) {
            const byId = await message.guild.channels.fetch(rawCategoryName).catch(() => null);
            if (byId && byId.type === ChannelType.GuildCategory) {
                category = byId;
            } else {
                return message.reply('❌ That ID is not a category channel.');
            }
        } else {
            const candidates = allChannels.filter(
                (c) => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase() === rawCategoryName.toLowerCase()
            );

            if (!candidates.size) {
                return message.reply(`❌ No category found named **${rawCategoryName}**.`);
            }

            // Prefer exact case match if available, otherwise take the first.
            const exactCase = candidates.find((c) => c.name === rawCategoryName);
            category = exactCase || candidates.first();

            // If multiple categories share the same name, force disambiguation via ID
            if (candidates.size > 1 && !exactCase) {
                const lines = [...candidates.values()]
                    .slice(0, 10)
                    .map((c) => `- **${c.name}** (id: \`${c.id}\`)`)
                    .join('\n');
                await message.reply(
                    [
                        `⚠️ Found **${candidates.size}** categories named **${rawCategoryName}**.`,
                        'Please re-run the command using the category ID:',
                        `\`${this.prefix}delete_category <category_id>\``,
                        '',
                        lines + (candidates.size > 10 ? `\n...and ${candidates.size - 10} more` : ''),
                    ].join('\n')
                );
                return;
            }
        }

        const children = allChannels
            .filter((c) => c && c.parentId === category.id)
            .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

        const channelLines = [...children.values()].map((c) => {
            const type =
                c.type === ChannelType.GuildText ? 'text' :
                c.type === ChannelType.GuildVoice ? 'voice' :
                c.type === ChannelType.GuildForum ? 'forum' :
                c.type === ChannelType.GuildStageVoice ? 'stage' :
                c.type === ChannelType.GuildAnnouncement ? 'announcement' :
                c.type === ChannelType.GuildMedia ? 'media' :
                'channel';
            return `- (${type}) ${c.name} (\`${c.id}\`)`;
        });

        const previewEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Category Deletion')
            .setDescription(
                [
                    `You are about to delete the category **${category.name}** (\`${category.id}\`).`,
                    '',
                    `This will also delete **${children.size}** channel(s) inside it.`,
                    '',
                    'Type `confirm` to proceed or `cancel` to abort.',
                ].join('\n')
            )
            .setColor(0xE74C3C);

        await message.reply({ embeds: [previewEmbed] });

        if (!children.size) {
            await message.reply('Preview: *(no channels inside this category)*');
        } else {
            // Send the preview list in chunks to avoid 2000 char limit
            const header = `Channels to be deleted (category: **${category.name}**):\n`;
            const chunks = [];
            let current = header;
            for (const line of channelLines) {
                // +1 for newline
                if ((current.length + line.length + 1) > 1900) {
                    chunks.push(current);
                    current = '';
                }
                current += (current ? '\n' : '') + line;
            }
            if (current) chunks.push(current);

            for (const chunk of chunks) {
                await message.reply(chunk);
            }
        }

        const filter = (m) =>
            m.author.id === message.author.id &&
            ['confirm', 'cancel'].includes(m.content.toLowerCase());
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });

        if (!collected.size || collected.first().content.toLowerCase() === 'cancel') {
            return message.reply('❌ Category deletion cancelled.');
        }

        // Delete children first, but keep the invoking channel (if applicable) for last so we can still report progress.
        const childrenSorted = [...children.values()];
        const invokeIdx = childrenSorted.findIndex((c) => c.id === message.channel.id);
        if (invokeIdx >= 0) {
            const [invokeChannel] = childrenSorted.splice(invokeIdx, 1);
            childrenSorted.push(invokeChannel);
        }

        await message.reply(`🧨 Deleting **${childrenSorted.length}** channel(s) in **${category.name}**...`);

        let deleted = 0;
        let failed = 0;
        const failures = [];

        for (const channel of childrenSorted) {
            try {
                await channel.delete(`Wolf.delete_category invoked by ${message.author.tag}`);
                deleted++;
            } catch (error) {
                failed++;
                failures.push(`- ${channel.name} (\`${channel.id}\`): ${error.message}`);
            }
        }

        let categoryDeleted = false;
        try {
            await category.delete(`Wolf.delete_category invoked by ${message.author.tag}`);
            categoryDeleted = true;
        } catch (error) {
            failures.push(`- [category] ${category.name} (\`${category.id}\`): ${error.message}`);
        }

        const summaryLines = [
            `✅ Deleted **${deleted}** channel(s).` + (failed ? ` ⚠️ Failed to delete **${failed}**.` : ''),
            categoryDeleted ? '✅ Deleted the category.' : '⚠️ Failed to delete the category.',
        ];

        // Try to send summary in-channel; if the invoking channel got deleted, fall back to DM.
        const summary = summaryLines.join('\n');
        try {
            await message.reply(summary);
        } catch (e) {
            try {
                await message.author.send(`Result of deleting category **${category.name}**:\n${summary}`);
            } catch (dmErr) {
                // nothing else we can do
            }
        }

        if (failures.length) {
            const failureText = failures.join('\n');
            const failureChunks = [];
            let current = 'Failures:\n';
            for (const line of failures) {
                if ((current.length + line.length + 1) > 1900) {
                    failureChunks.push(current);
                    current = '';
                }
                current += (current ? '\n' : '') + line;
            }
            if (current) failureChunks.push(current);

            for (const chunk of failureChunks) {
                try {
                    await message.reply(chunk);
                } catch (e) {
                    try {
                        await message.author.send(chunk);
                    } catch (dmErr) {
                        break;
                    }
                }
            }
        }
    }

    async handleAlive(message, isAddDead) {
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
            return message.reply('❌ Alive role not found. Please use `Wolf.server_roles` to set up roles.');
        }
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');
        if (!deadRole) {
            return message.reply('❌ Alive role not found. Please use `Wolf.server_roles` to set up roles.');
        }

        // OPTIMIZATION: Fetch all guild members at once instead of individual calls
        const alivePlayers = [];
        try {
            // Use cached members for much faster processing
            await message.guild.members.fetch();
            for (const player of allPlayers.rows) {
                const member = message.guild.members.cache.get(player.user_id);
                if (member) {
                    if (member.roles.cache.has(aliveRole.id) || (isAddDead && member.roles.cache.has(deadRole.id))) {
                        alivePlayers.push(player.username);
                    }
                }
            }
        } catch (error) {
            console.log('Could not fetch all guild members, falling back to individual fetches');
            // Fallback to original method if bulk fetch fails            
            for (const player of allPlayers.rows) {
                try {
                    const member = await message.guild.members.fetch(player.user_id);
                    if (member.roles.cache.has(aliveRole.id) || (isAddDead && member.roles.cache.has(deadRole.id))) {
                        alivePlayers.push(player.username);
                    }
                } catch (error) {
                    console.log(`Could not fetch member ${player.user_id}, skipping`);
                }
            }
        }        

        if (alivePlayers.length === 0) {
            return message.reply('💀 No players are currently alive in the game.');
        }

        // Sort players by stripping non-alphanumeric characters while maintaining original display names
        const sortedAlivePlayers = alivePlayers.sort((a, b) => {
            const aClean = a.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const bClean = b.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            return aClean.localeCompare(bClean);
        });

        const playerList = sortedAlivePlayers.map((player, index) => `${index + 1}. ${player}`).join('\n');
        
        // Split into multiple embeds if too long (max 1024 chars per field)
        const embeds = [];
        const title = isAddDead ? '👥 All Players' : '💚 Alive Players';
        const description = isAddDead ? 'Here are all players, alive or dead, in this game:' : `Here are all the players currently alive in the game:`;
        
        if (playerList.length > 1024) {
            // Split into chunks
            const chunks = [];
            const lines = sortedAlivePlayers.map((player, index) => `${index + 1}. ${player}`);
            let currentChunk = '';
            let currentIndex = 1;
            let chunkStartIndex = 1;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if ((currentChunk + line + '\n').length > 1024) {
                    if (currentChunk) {
                        chunks.push({
                            text: currentChunk.trim(),
                            startIndex: chunkStartIndex,
                            endIndex: currentIndex - 1
                        });
                    }
                    currentChunk = line + '\n';
                    chunkStartIndex = currentIndex;
                } else {
                    currentChunk += line + '\n';
                }
                currentIndex++;
            }
            if (currentChunk) {
                chunks.push({
                    text: currentChunk.trim(),
                    startIndex: chunkStartIndex,
                    endIndex: sortedAlivePlayers.length
                });
            }
            
            // Create embeds for each chunk
            chunks.forEach((chunk, index) => {
                const chunkTitle = index === 0 ? title : `${title} (continued)`;
                const fieldName = chunks.length > 1 
                    ? `Players ${chunk.startIndex}-${chunk.endIndex} (${alivePlayers.length} total)`
                    : `Players (${alivePlayers.length})`;
                
                const embed = new EmbedBuilder()
                    .setTitle(chunkTitle)
                    .addFields({ 
                        name: fieldName, 
                        value: chunk.text 
                    })
                    .setColor(0x00FF00)
                    .setTimestamp();
                
                // Only set description for the first embed
                if (index === 0) {
                    embed.setDescription(description);
                }
                
                embeds.push(embed);
            });
        } else {
            // Single embed if it fits
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .addFields({ 
                    name: `Players (${alivePlayers.length})`, 
                    value: playerList 
                })
                .setColor(0x00FF00)
                .setTimestamp();
            embeds.push(embed);
        }

        await message.reply({ embeds: embeds });
    }

    async handleDead(message) {
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

        // Filter dead players by checking Discord roles
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');
        if (!deadRole) {
            return message.reply('❌ Dead role not found. Please use `Wolf.server_roles` to set up roles.');
        }

        // OPTIMIZATION: Fetch all guild members at once instead of individual calls
        const deadPlayers = [];
        try {
            // Use cached members for much faster processing
            await message.guild.members.fetch();
            for (const player of allPlayers.rows) {
                const member = message.guild.members.cache.get(player.user_id);
                if (member) {
                    if (member.roles.cache.has(deadRole.id)) {
                        deadPlayers.push(player.username);
                    }
                }
            }
        } catch (error) {
            console.log('Could not fetch all guild members, falling back to individual fetches');
            // Fallback to original method if bulk fetch fails            
            for (const player of allPlayers.rows) {
                try {
                    const member = await message.guild.members.fetch(player.user_id);
                    if (member.roles.cache.has(deadRole.id)) {
                        deadPlayers.push(player.username);
                    }
                } catch (error) {
                    console.log(`Could not fetch member ${player.user_id}, skipping`);
                }
            }
        }        

        if (deadPlayers.length === 0) {
            return message.reply('✨ No players are currently dead in the game. WOLVES BETTER GET TO WORK!');
        }

        // Sort players by stripping non-alphanumeric characters while maintaining original display names
        const sortedDeadPlayers = deadPlayers.sort((a, b) => {
            const aClean = a.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const bClean = b.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            return aClean.localeCompare(bClean);
        });

        const playerList = sortedDeadPlayers.map((player, index) => `${index + 1}. ${player}`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle('💀 Dead Players')
            .setDescription('Here are all the players currently dead in the game:')
            .addFields({ 
                name: `Players (${deadPlayers.length})`, 
                value: playerList 
            })
            .setColor(0x808080);

        await message.reply({ embeds: [embed] });
    }

    async handleInList(message, args) {
        const serverId = message.guild.id;

        // Get active game in signup phase
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3)',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game available.');
        }

        const game = gameResult.rows[0];

        // Get all signed up players
        const playersResult = await this.db.query(
            'SELECT username FROM players WHERE game_id = $1',
            [game.id]
        );

        if (playersResult.rows.length === 0) {
            return message.reply('📝 No players have signed up yet.');
        }

        // Create a simple, mobile-friendly format with alphanumeric sorting
        const playerNames = playersResult.rows.map(p => p.username);
        
        // Check if za parameter is provided for reverse sorting
        const reverseSort = args.includes('za');
        
        // Sort players by stripping non-alphanumeric characters while maintaining original display names
        const sortedPlayerNames = playerNames.sort((a, b) => {
            const aClean = a.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const bClean = b.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const comparison = aClean.localeCompare(bClean);
            return reverseSort ? -comparison : comparison;
        });
        
        const playerList = sortedPlayerNames.join('\n');

        const serverConfig = await this.db.query(
            'SELECT * FROM server_configs WHERE server_id = $1',
            [serverId]
        );
        const config = serverConfig.rows[0];
        const gameName = config.game_name ? `${config.game_name} Game ${game.game_number}` : `Game ${game.game_number}`;

        // Send as a code block for easy copying
        const response = `**${gameName} Player List (${playersResult.rows.length}):**\n${playerList}`;

        await message.reply(response);
    }

    async handleSignups(message, args) {
        const serverId = message.guild.id;

        // Check if user has moderator permissions
        if (!this.hasModeratorPermissions(message.member)) {
            return message.reply('❌ Only moderators can manage signups.');
        }

        if (!args.length || (args[0].toLowerCase() !== 'open' && args[0].toLowerCase() !== 'close')) {
            return message.reply('❌ Usage: `Wolf.signups open` or `Wolf.signups close`');
        }

        const action = args[0].toLowerCase();
        const isClosing = action === 'close';

        // Get active game in signup phase
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'signup']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game in signup phase found.');
        }

        const game = gameResult.rows[0];

        // Update the signups_closed flag
        await this.db.query(
            'UPDATE games SET signups_closed = $1 WHERE id = $2',
            [isClosing, game.id]
        );

        // Post message in signup channel
        try {
            const signupChannel = await this.client.channels.fetch(game.signup_channel_id);
            if (signupChannel) {
                const statusMessage = isClosing 
                    ? '🔒 **Signups are now CLOSED.**' 
                    : '🔓 **Signups are now OPEN.**';
                await signupChannel.send(statusMessage);
            }
        } catch (error) {
            console.error('Error posting signup status message:', error);
        }

        const statusText = isClosing ? 'closed' : 'opened';
        await message.reply(`✅ Signups have been ${statusText}.`);
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
                'INSERT INTO game_channels (game_id, channel_id, channel_name, day_message, night_message, is_created) VALUES ($1, $2, $3, $4, $5, $6)',
                [game.id, newChannel.id, fullChannelName, game.day_message, game.night_message, true]
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

    async killPlayer(message) {
        // Check if user mentioned someone
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply('❌ Please mention a user to kill: `Wolf.kill @user`');
        }
        
        // Check if the mentioned user is in the server
        const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            return message.reply('❌ That user is not in this server!');
        }

        if (await this.removeRole(targetMember, 'Alive')) {
            await this.assignRole(targetMember, 'Dead');
        } else {
            return message.reply(`🪦 That user is not Alive in this game!`);
        }
    }

    async permsTest(message, args) {   
        
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
        console.log("MEMBER:", JSON.stringify(targetMember));

        const channel = message.mentions.channels.first();
        if (!channel) {
            return message.reply('❌ Please mention a channel');
        }
        else if (channel.guild != message.guild) {
            return message.reply('❌ That channel is not in this server');
        }
        
        await channel.permissionOverwrites.edit(targetMember.id, {
            [PIN_PERMISSION]: true
        });

        return message.reply(`Granted ${targetMember} PinPermissions`);
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
            return message.reply('❌ No games found. Please create a game first.');
        }

        const game = gameResult.rows[0];

        try {
            // Proactively check if we need to split journals before creating a new one
            const splitPerformed = await this.checkAndProactivelySplitJournals(message.guild, message);
            
            // Find the appropriate journal category for this user (may have changed after split)
            let targetCategory = await this.findAppropriateJournalCategory(message.guild, targetMember.displayName);

            if (!targetCategory) {
                // Create the main Journals category if no categories exist
                targetCategory = await message.guild.channels.create({
                    name: 'Journals',
                    type: ChannelType.GuildCategory,
                });

                // Position it under the current game but above other games
                try {
                    const currentGameCategory = await this.client.channels.fetch(game.category_id);
                    if (currentGameCategory) {
                        const targetPosition = currentGameCategory.position + 1;
                        await targetCategory.setPosition(targetPosition);
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
                channel => channel.name === journalChannelName && channel.parent?.id === targetCategory.id
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
                parent: targetCategory.id,
                permissionOverwrites: [
                    {
                        id: message.guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: targetUser.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PIN_PERMISSION],
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

            // After creating the journal, alphabetize it within its category and check if we need to rebalance
            await this.alphabetizeJournalsInCategory(message.guild, targetCategory);
            await this.checkAndRebalanceJournals(message.guild);

        } catch (error) {
            console.error('Error creating journal:', error);
            await message.reply('❌ An error occurred while creating the journal.');
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

        // Arguments can be:
        // - none: default channel (town square) + default start time (same as before)
        // - one arg: if it's a date => treat as date; otherwise treat as channel name
        // - two+ args: if first arg is a date => treat all as date/time; otherwise first is channel and remaining are date/time
        const looksLikeDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
        const looksLikeTime = (s) => /^\d{2}:\d{2}$/.test(s);

        let channelArg = null;
        let dateParts = [];

        if (args && args.length) {
            if (args.length === 1) {
                if (looksLikeDate(args[0])) {
                    dateParts = [args[0]];
                } else {
                    channelArg = args[0];
                }
            } else {
                if (looksLikeDate(args[0])) {
                    dateParts = args;
                } else {
                    channelArg = args[0];
                    dateParts = args.slice(1);
                }
            }
        }

        console.log(dateParts);
        console.log(channelArg);

        // Default start time behavior: if no date provided, use current date in EST/EDT (with the 9:30 AM cutoff)
        if (!dateParts.length) {
            const now = moment.tz("America/New_York");
            const cutoffTime = moment.tz("America/New_York").hour(9).minute(30).second(0).millisecond(0);

            // If it's before 9:30 AM EST today, search from 9:30 AM yesterday
            const searchDate = now.isBefore(cutoffTime)
                ? now.subtract(1, 'day').format('YYYY-MM-DD')
                : now.format('YYYY-MM-DD');

            dateParts = [searchDate, '09:30'];
        } else if (dateParts.length === 1) {
            // Date provided without time => default time to 09:30
            if (!looksLikeDate(dateParts[0])) {
                return message.reply('❌ Invalid date format. Please use: `Wolf.ia [channel] YYYY-MM-DD [HH:MM]` (EST timezone)\nExamples:\n- `Wolf.ia 2024-12-01`\n- `Wolf.ia town-square 2024-12-01 14:30`');
            }
            dateParts = [dateParts[0], '09:30'];
        } else {
            // If time is present, validate it (and ignore any extra parts beyond date+time)
            if (!looksLikeDate(dateParts[0]) || !looksLikeTime(dateParts[1])) {
                return message.reply('❌ Invalid date/time format. Please use: `Wolf.ia [channel] YYYY-MM-DD [HH:MM]` (24-hour format, EST timezone)\nExamples:\n- `Wolf.ia 2024-12-01 14:30`\n- `Wolf.ia town-square 2024-12-01 14:30`');
            }
            dateParts = [dateParts[0], dateParts[1]];
        }

        // Parse the date/time argument
        const dateTimeStr = dateParts.join(' ');
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
            // Resolve which channel to check for activity
            const resolveActivityChannel = async () => {
                // Default to the game's town square channel
                if (!channelArg) {
                    return await this.client.channels.fetch(game.town_square_channel_id);
                }

                console.log("channelArg:", channelArg);

                // Support channel mention (<#id>), raw ID, "#name", or "name"
                const mentionMatch = channelArg.match(/^<#(\d+)>$/);
                const rawIdMatch = channelArg.match(/^\d+$/);
                let channelId = null;
                let channelName = null;

                if (mentionMatch) {
                    channelId = mentionMatch[1];
                } else if (rawIdMatch) {
                    channelId = channelArg;
                } else {
                    channelName = channelArg.replace(/^#/, '').trim().toLowerCase();
                }

                // If we have an ID, fetch directly
                if (channelId) {
                    try {
                        return await message.guild.channels.fetch(channelId);
                    } catch (e) {
                        return null;
                    }
                }

                // Otherwise, search by name (cache first, then fetch all)
                const findByName = () => message.guild.channels.cache.find(ch =>
                    ch &&
                    typeof ch.name === 'string' &&
                    ch.name.toLowerCase() === channelName
                );

                let found = findByName();
                if (found) return found;

                try {
                    await message.guild.channels.fetch();
                } catch (e) {
                    // ignore; we'll fall back to cache search
                }

                found = findByName();
                return found || null;
            };

            const activityChannel = await resolveActivityChannel();
            console.log("activityChannel:", activityChannel);
            if (!activityChannel) {
                return message.reply(channelArg
                    ? `❌ Channel not found: \`${channelArg}\`. Try \`Wolf.ia #channel-name\` or \`Wolf.ia 123456789012345678\`.`
                    : '❌ Town square channel not found.');
            }

            // Ensure it's a text-based channel we can read messages from
            if (typeof activityChannel.isTextBased === 'function' && !activityChannel.isTextBased()) {
                return message.reply(`❌ \`${activityChannel.name || channelArg}\` is not a text channel.`);
            }
            if (!activityChannel.messages || typeof activityChannel.messages.fetch !== 'function') {
                return message.reply(`❌ Can't read messages from \`${activityChannel.name || channelArg}\`.`);
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

                // Fetch messages from the selected channel since the specified date
                let allMessages = [];
                let lastMessageId = null;
                
                // Discord API limits us to 100 messages per request, so we need to paginate
                while (true) {
                    const options = { limit: 100 };
                    if (lastMessageId) {
                        options.before = lastMessageId;
                    }

                    const messages = await activityChannel.messages.fetch(options);
                    
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
                    .setTitle('📊 Activity Report')
                    .setDescription(`Message count per player since **${dateTimeStr} EST**`)
                    .addFields(
                        { name: `Player Activity (${sortedPlayers.length} players)`, value: playerList },
                        { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${activityChannel.name}`, inline: false }
                    )
                    .setColor(0x3498DB)
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
                return await message.reply('Did you know there is a `speed_check` command? It will tell you who sent messages in this phase of the game!');
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

            // Fetch messages from the selected channel since the specified date
            let allMessages = [];
            let lastMessageId = null;
            
            // Discord API limits us to 100 messages per request, so we need to paginate
            while (true) {
                const options = { limit: 100 };
                if (lastMessageId) {
                    options.before = lastMessageId;
                }

                const messages = await activityChannel.messages.fetch(options);
                
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
                .setTitle('📊 Activity Report')
                .setDescription(`Message count per player since **${dateTimeStr} EST**`)
                .addFields(
                    { name: `Player Activity (${sortedPlayers.length} players)`, value: playerList },
                    { name: 'Summary', value: `**Total messages**: ${totalMessages}\n**Channel**: ${activityChannel.name}`, inline: false }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            return await message.reply('Did you know there is a `speed_check` command? It will tell you who sent messages in this phase of the game!');

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

    async handleSetVotingBooth(message, args) {
        const serverId = message.guild.id;

        // Check if channel name was provided
        if (!args.length) {
            return message.reply('❌ Please provide a channel name. Usage: `Wolf.set_voting_booth <channel-name>`');
        }

        let channelName = args.join(' ').trim();
        
        // Remove # prefix if present
        if (channelName.startsWith('#')) {
            channelName = channelName.slice(1);
        }

        // Get current game (signup or active)
        const gameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3) ORDER BY id DESC LIMIT 1',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Find the channel in the guild
        const channel = message.guild.channels.cache.find(c => 
            c.name.toLowerCase() === channelName.toLowerCase()
        );

        if (!channel) {
            return message.reply(`❌ Could not find channel "${channelName}" in this server.`);
        }

        // Update the voting booth channel ID in the database
        await this.db.query(
            'UPDATE games SET voting_booth_channel_id = $1 WHERE id = $2',
            [channel.id, game.id]
        );

        return message.reply(`✅ Voting booth set to <#${channel.id}> (${channel.name}) for game ${game.game_number}.`);
    }

    async handleRolesList(message) {
        if (this.isPublicChannel(message)) {
            return message.reply('WOAH! You trying to scuff the game? Wrong channel buddy!');
        }

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

        const playersResult = await this.db.query(
            `SELECT p.user_id, p.username, p.role_id, p.status, p.is_wolf,
                    r.name as role_name, r.team, r.in_wolf_chat,
                    gr.custom_name
             FROM players p
             LEFT JOIN roles r ON p.role_id = r.id
             LEFT JOIN game_role gr ON p.game_id = gr.game_id AND p.role_id = gr.role_id
             WHERE p.game_id = $1 ORDER BY p.username`,
            [game.id]
        );

        if (playersResult.rows.length === 0) {
            return message.reply('❌ No players found in the current game.');
        }

        // Check if any roles have been assigned
        const playersWithRoles = playersResult.rows.filter(player => player.role_id !== null);
        
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

        // Get game theme flags
        const gameThemeResult = await this.db.query(
            'SELECT is_skinned, is_themed FROM games WHERE id = $1',
            [game.id]
        );
        const gameTheme = gameThemeResult.rows[0] || { is_skinned: false, is_themed: false };

        // Group players by team alignment
        const townPlayers = [];
        const wolfPlayers = [];
        const neutralPlayers = [];
        const noRolePlayers = [];

        // Helper function to format role display
        const formatRoleDisplay = (player) => {
            let roleText = '_No role assigned_';
            
            if (player.role_id) {
                let displayRoleName = player.role_name;
                
                if (gameTheme.is_themed && player.custom_name) {
                    // Themed mode: only show custom name
                    displayRoleName = player.custom_name;
                } else if (gameTheme.is_skinned && player.custom_name) {
                    // Skinned mode: show custom name with actual role in parens
                    displayRoleName = `${player.custom_name} (${player.role_name})`;
                } else {
                    // Normal mode: show actual role name
                    displayRoleName = player.role_name;
                }
                
                roleText = `**${displayRoleName}**`;
                
                // Add wolf chat indicator
                if (player.is_wolf && player.in_wolf_chat) {
                    roleText += ' 🐺';
                }
            }
            
            return `${roleText} - ${player.username}`;
        };

        // Sort players into teams
        playersWithRoles.forEach(player => {
            const team = player.team?.toLowerCase();
            if (team === 'town') {
                townPlayers.push(player);
            } else if (team === 'wolves' || team === 'wolf') {
                wolfPlayers.push(player);
            } else if (team === 'neutral' || team === 'neutrals') {
                neutralPlayers.push(player);
            } else {
                // Fallback for unknown teams
                neutralPlayers.push(player);
            }
        });

        // Add players without roles
        playersResult.rows.filter(player => player.role_id === null).forEach(player => {
            noRolePlayers.push(player);
        });

        // Build organized role list
        const roleSections = [];
        
        if (townPlayers.length > 0) {
            const mappedTownPlayers = townPlayers.map(formatRoleDisplay);
            mappedTownPlayers.sort((a, b) => a.localeCompare(b));
            roleSections.push(`**🏘️ TOWN**\n${mappedTownPlayers.join('\n')}`);
        }
        
        if (wolfPlayers.length > 0) {
            const mappedWolfPlayers = wolfPlayers.map(formatRoleDisplay);
            mappedWolfPlayers.sort((a, b) => a.localeCompare(b));
            roleSections.push(`**🐺 WOLVES**\n${mappedWolfPlayers.join('\n')}`);
        }
        
        if (neutralPlayers.length > 0) {
            const mappedNeutralPlayers = neutralPlayers.map(formatRoleDisplay);
            mappedNeutralPlayers.sort((a, b) => a.localeCompare(b));
            roleSections.push(`**⚖️ NEUTRALS**\n${mappedNeutralPlayers.join('\n')}`);
        }
        
        if (noRolePlayers.length > 0) {
            roleSections.push(`**❓ UNASSIGNED**\n${noRolePlayers.map(formatRoleDisplay).join('\n')}`);
        }

        // Count role occurrences
        const roleCounts = {};
        playersWithRoles.forEach(player => {
            let roleName = player.role_name;
            if (gameTheme.is_themed && player.custom_name) {
                roleName = player.custom_name;
            } else if (gameTheme.is_skinned && player.custom_name) {
                roleName = `${player.custom_name} (${player.role_name})`;
            }
            roleCounts[roleName] = (roleCounts[roleName] || 0) + 1;
        });

        const roleSummary = Object.entries(roleCounts)
            .map(([role, count]) => count > 1 ? `${role} (${count})` : role)
            .join(', ');

        // Create separate embeds for each team to avoid 1024 character limit
        const embeds = [];
        const gameTitle = `${game.game_name ? `${game.game_name} ` : ''}Game ${game.game_number}`;

        // Town embed
        if (townPlayers.length > 0) {
            const mappedTownPlayers = townPlayers.map(formatRoleDisplay);
            mappedTownPlayers.sort((a, b) => a.localeCompare(b));
            const townList = mappedTownPlayers.join('\n');
            
            // Split into chunks if too long (max 1024 chars per field)
            if (townList.length > 1024) {
                const chunks = [];
                const lines = mappedTownPlayers;
                let currentChunk = '';
                
                for (const line of lines) {
                    if ((currentChunk + line + '\n').length > 1024) {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        currentChunk = line + '\n';
                    } else {
                        currentChunk += line + '\n';
                    }
                }
                if (currentChunk) chunks.push(currentChunk.trim());
                
                chunks.forEach((chunk, index) => {
                    const embed = new EmbedBuilder()
                        .setTitle(index === 0 ? '🏘️ TOWN' : '🏘️ TOWN (continued)')
                        .setDescription(chunk)
                        .setColor(0x3498DB)
                        .setTimestamp();
                    embeds.push(embed);
                });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('🏘️ TOWN')
                    .setDescription(townList)
                    .setColor(0x3498DB)
                    .setTimestamp();
                embeds.push(embed);
            }
        }

        // Wolves embed
        if (wolfPlayers.length > 0) {
            const mappedWolfPlayers = wolfPlayers.map(formatRoleDisplay);
            mappedWolfPlayers.sort((a, b) => a.localeCompare(b));
            const wolfList = mappedWolfPlayers.join('\n');
            
            if (wolfList.length > 1024) {
                const chunks = [];
                const lines = mappedWolfPlayers;
                let currentChunk = '';
                
                for (const line of lines) {
                    if ((currentChunk + line + '\n').length > 1024) {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        currentChunk = line + '\n';
                    } else {
                        currentChunk += line + '\n';
                    }
                }
                if (currentChunk) chunks.push(currentChunk.trim());
                
                chunks.forEach((chunk, index) => {
                    const embed = new EmbedBuilder()
                        .setTitle(index === 0 ? '🐺 WOLVES' : '🐺 WOLVES (continued)')
                        .setDescription(chunk)
                        .setColor(0xE74C3C)
                        .setTimestamp();
                    embeds.push(embed);
                });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('🐺 WOLVES')
                    .setDescription(wolfList)
                    .setColor(0xE74C3C)
                    .setTimestamp();
                embeds.push(embed);
            }
        }

        // Neutrals embed
        if (neutralPlayers.length > 0) {
            const mappedNeutralPlayers = neutralPlayers.map(formatRoleDisplay);
            mappedNeutralPlayers.sort((a, b) => a.localeCompare(b));
            const neutralList = mappedNeutralPlayers.join('\n');
            
            if (neutralList.length > 1024) {
                const chunks = [];
                const lines = mappedNeutralPlayers;
                let currentChunk = '';
                
                for (const line of lines) {
                    if ((currentChunk + line + '\n').length > 1024) {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        currentChunk = line + '\n';
                    } else {
                        currentChunk += line + '\n';
                    }
                }
                if (currentChunk) chunks.push(currentChunk.trim());
                
                chunks.forEach((chunk, index) => {
                    const embed = new EmbedBuilder()
                        .setTitle(index === 0 ? '⚖️ NEUTRALS' : '⚖️ NEUTRALS (continued)')
                        .setDescription(chunk)
                        .setColor(0xF39C12)
                        .setTimestamp();
                    embeds.push(embed);
                });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('⚖️ NEUTRALS')
                    .setDescription(neutralList)
                    .setColor(0xF39C12)
                    .setTimestamp();
                embeds.push(embed);
            }
        }

        // Unassigned embed
        if (noRolePlayers.length > 0) {
            const unassignedList = noRolePlayers.map(formatRoleDisplay).join('\n');
            
            if (unassignedList.length > 1024) {
                const chunks = [];
                const lines = noRolePlayers.map(formatRoleDisplay);
                let currentChunk = '';
                
                for (const line of lines) {
                    if ((currentChunk + line + '\n').length > 1024) {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        currentChunk = line + '\n';
                    } else {
                        currentChunk += line + '\n';
                    }
                }
                if (currentChunk) chunks.push(currentChunk.trim());
                
                chunks.forEach((chunk, index) => {
                    const embed = new EmbedBuilder()
                        .setTitle(index === 0 ? '❓ UNASSIGNED' : '❓ UNASSIGNED (continued)')
                        .setDescription(chunk)
                        .setColor(0x95A5A6)
                        .setTimestamp();
                    embeds.push(embed);
                });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('❓ UNASSIGNED')
                    .setDescription(unassignedList)
                    .setColor(0x95A5A6)
                    .setTimestamp();
                embeds.push(embed);
            }
        }

        // Summary embed (always last)
        const summaryEmbed = new EmbedBuilder()
            .setTitle('🎭 Player Roles Summary')
            .setDescription(`Role assignments for ${gameTitle}`)
            .addFields(
                { name: 'Role Summary', value: roleSummary || 'No roles assigned', inline: false },
                { name: 'Legend', value: '🐺 = In Wolf Chat', inline: false }
            )
            .setColor(0x9B59B6)
            .setTimestamp();
        embeds.push(summaryEmbed);

        await message.reply({ embeds: embeds });
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

    async handleJournalPinPerms(message) {
        // Get all journal categories
        const journalCategories = message.guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory && 
            (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
        );

        if (journalCategories.size === 0) {
            return message.reply('❌ No journal categories found. Create some journals first with `Wolf.journal @user`.');
        }

        // Get all journal channels from all categories
        const allJournalChannels = [];
        for (const category of journalCategories.values()) {
            const categoryChannels = message.guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            allJournalChannels.push(...categoryChannels.values());
        }

        if (allJournalChannels.length === 0) {
            return message.reply('❌ No journal channels found in any journal categories.');
        }

        const failed = [];
        const serverId = message.guild.id;
        for (const journal of allJournalChannels) {
            // I'm sure this could be done with a single query for all player journal results but this command will only run once so performance doesn't seem that important
            const playerResult = await this.db.query(
                'SELECT user_id FROM player_journals WHERE server_id = $1 AND channel_id = $2',
                [serverId, journal.id]
            );
            if (playerResult.rows.length === 0) {
                failed.push(`\t${journal.name} has no user_id`);
            }
            else {
                const user_id = playerResult.rows[0].user_id;
                const member = await message.guild.members.fetch(user_id).catch(() => null);
                if (!member) {
                    failed.push(`\t${journal.name} user ${user_id} not in server`);
                } else {
                    await journal.permissionOverwrites.edit(member.id, {
                        [PIN_PERMISSION]: true
                    });
                }
            }
        }

        if (failed.length > 0) {
            return message.reply(`❌ Failed for ${failed.length} Journals:\n${failed.join('\n')}`);
        } else {
            return message.reply('Success!');
        }
    }

    async handleFixJournals(message) {
        const serverId = message.guild.id;

        // Get all journal categories
        const journalCategories = message.guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory && 
            (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
        );

        if (journalCategories.size === 0) {
            return message.reply('❌ No journal categories found. Create some journals first with `Wolf.journal @user`.');
        }

        // Get all journal channels from all categories
        const allJournalChannels = [];
        for (const category of journalCategories.values()) {
            const categoryChannels = message.guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            allJournalChannels.push(...categoryChannels.values());
        }

        if (allJournalChannels.length === 0) {
            return message.reply('❌ No journal channels found in any journal categories.');
        }

        // Fetch all journals for this server from the database in one query
        const journalChannelIds = allJournalChannels.map(channel => channel.id);
        const allJournalsResult = await this.db.query(
            'SELECT channel_id, user_id FROM player_journals WHERE server_id = $1 AND channel_id = ANY($2)',
            [serverId, journalChannelIds]
        );

        // Create a map of channel_id -> user_id for quick lookup
        const journalMap = new Map();
        for (const row of allJournalsResult.rows) {
            journalMap.set(row.channel_id, row.user_id);
        }

        // Send initial progress message
        const progressMsg = await message.reply(`🔍 Found ${allJournalChannels.length} journal channels. Starting to fix permissions...`);

        const failed = [];
        let processedCount = 0;

        // Get roles for permissions
        const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');
        const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
        const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');
        const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
        const signedUpRole = message.guild.roles.cache.find(r => r.name === 'Signed Up');

        for (const journal of allJournalChannels) {
            processedCount++;
            try {
                // Look up the journal owner from the map
                const userId = journalMap.get(journal.id);

                if (!userId) {
                    failed.push(`\t${journal.name} has no user_id mapping in player_journals`);
                    await progressMsg.edit(`🔍 Processing journal ${processedCount}/${allJournalChannels.length}... ⚠️ ${journal.name} has no user_id mapping`);
                    continue;
                }
                const member = await message.guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    failed.push(`\t${journal.name} user ${userId} not in server`);
                    await progressMsg.edit(`🔍 Processing journal ${processedCount}/${allJournalChannels.length}... ⚠️ ${journal.name} user not found`);
                    continue;
                }

                // Update progress message every 10 journals or for the first few
                if (processedCount <= 5 || processedCount % 10 === 0 || processedCount === allJournalChannels.length) {
                    await progressMsg.edit(`🔍 Processing journal ${processedCount}/${allJournalChannels.length}: ${journal.name}...`);
                }

                // Everyone: can see but not send
                await journal.permissionOverwrites.edit(message.guild.roles.everyone, {
                    ViewChannel: true,
                    SendMessages: false
                });

                // Alive: cannot see
                if (aliveRole) {
                    await journal.permissionOverwrites.edit(aliveRole, {
                        ViewChannel: false,
                        SendMessages: false
                    });
                }

                // Signed Up: cannot see
                if (signedUpRole) {
                    await journal.permissionOverwrites.edit(signedUpRole, {
                        ViewChannel: false,
                        SendMessages: false
                    });
                }

                // Journal owner: can see and write
                await journal.permissionOverwrites.edit(member.id, {
                    ViewChannel: true,
                    SendMessages: true
                });

                // Mods: can see and write (preserve moderator access)
                if (modRole) {
                    await journal.permissionOverwrites.edit(modRole, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                }

                // Spectators: can see but not send (match creation logic)
                if (spectatorRole) {
                    await journal.permissionOverwrites.edit(spectatorRole, {
                        ViewChannel: true,
                        SendMessages: false
                    });
                }

                // Dead: can see but not send (match creation logic)
                if (deadRole) {
                    await journal.permissionOverwrites.edit(deadRole, {
                        ViewChannel: true,
                        SendMessages: false
                    });
                }

            } catch (error) {
                console.error(`Error fixing permissions for journal ${journal.id} (${journal.name}):`, error);
                failed.push(`\t${journal.name} encountered error: ${error.message || error}`);
                await progressMsg.edit(`🔍 Processing journal ${processedCount}/${allJournalChannels.length}... ❌ Error with ${journal.name}`);
            }
        }

        // Final status message
        if (failed.length > 0) {
            await progressMsg.edit(`⚠️ Completed with issues for ${failed.length} journals:\n${failed.join('\n')}`);
        } else {
            await progressMsg.edit(`✅ Successfully fixed permissions for all ${allJournalChannels.length} journal channels.`);
        }
    }

    async handleBalanceJournals(message) {
        const serverId = message.guild.id;

        // Check if user has moderator permissions
        if (!this.hasModeratorPermissions(message.member)) {
            return message.reply('❌ You need moderator permissions to use this command.');
        }

        try {
            // Send initial progress message
            let progressMsg = await message.reply('🔍 Scanning for journal categories and channels...');

            // Get all journal categories
            const journalCategories = message.guild.channels.cache.filter(
                channel => channel.type === ChannelType.GuildCategory && 
                (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
            );

            if (journalCategories.size === 0) {
                await progressMsg.edit('❌ No journal categories found. Create some journals first with `Wolf.journal @user`.');
                return;
            }

            await progressMsg.edit(`🔍 Found ${journalCategories.size} journal category/categories. Collecting journal channels...`);

            // Get all journal channels from all categories
            const allJournalChannels = [];
            for (const category of journalCategories.values()) {
                const categoryChannels = message.guild.channels.cache.filter(
                    channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
                );
                allJournalChannels.push(...categoryChannels.values());
            }

            if (allJournalChannels.length === 0) {
                await progressMsg.edit('❌ No journal channels found in any journal categories.');
                return;
            }

            await progressMsg.edit(`📚 Found ${allJournalChannels.length} journal channels. Sorting alphabetically...`);

            // Sort journals alphabetically by display name (extracted from channel name)
            allJournalChannels.sort((a, b) => {
                const nameA = a.name.replace('-journal', '').toLowerCase();
                const nameB = b.name.replace('-journal', '').toLowerCase();
                return nameA.localeCompare(nameB);
            });

            const totalJournals = allJournalChannels.length;
            const maxChannelsPerCategory = 50;

            // If we have less than 50 journals, just alphabetize in current structure
            if (totalJournals < maxChannelsPerCategory) {
                await progressMsg.edit(`📚 Organizing ${totalJournals} journals in single category...`);
                await this.alphabetizeJournalsInCategory(message.guild, journalCategories.first());
                await progressMsg.edit(`✅ Journals are already properly organized! Found ${totalJournals} journals in a single category. All journals have been alphabetized.`);
                return;
            }

            // We need to split into multiple categories (50+ journals, including exactly 50)
            // This ensures we stay well under the Discord limit
            // For exactly 50 journals, we split into 2 categories of 25 each
            const numCategoriesNeeded = totalJournals >= maxChannelsPerCategory ? Math.max(2, Math.ceil(totalJournals / maxChannelsPerCategory)) : 1;

            // We need to split into multiple categories
            const journalsPerCategory = Math.ceil(totalJournals / numCategoriesNeeded);
            
            await progressMsg.edit(`📚 Need to split ${totalJournals} journals into ${numCategoriesNeeded} categories. Creating/updating categories...`);
            
            // Handle category creation/renaming for proper alphabetical order
            const newCategories = [];
            
            // Find the original "Journals" category
            const originalJournalsCategory = message.guild.channels.cache.find(
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
                    await progressMsg.edit(`📝 Renaming "Journals" category to "${categoryName}"...`);
                    await originalJournalsCategory.setName(categoryName);
                    category = originalJournalsCategory;
                    console.log(`📝 Renamed "Journals" to "${categoryName}"`);
                } else {
                    // For subsequent categories, create new ones
                    category = message.guild.channels.cache.find(
                        channel => channel.type === ChannelType.GuildCategory && channel.name === categoryName
                    );
                    
                    if (!category) {
                        // Create new category
                        await progressMsg.edit(`📝 Creating category "${categoryName}" (${i + 1}/${numCategoriesNeeded})...`);
                        category = await message.guild.channels.create({
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

            // First, move all journals to their appropriate categories
            let movedCount = 0;
            const movedJournals = []; // Track moved journals and their original permissions
            
            await progressMsg.edit(`📦 Moving journals to their appropriate categories...`);
            
            for (let i = 0; i < numCategoriesNeeded; i++) {
                const startIndex = i * journalsPerCategory;
                const endIndex = Math.min((i + 1) * journalsPerCategory, totalJournals);
                const categoryJournals = allJournalChannels.slice(startIndex, endIndex);
                
                await progressMsg.edit(`📦 Moving journals to category "${newCategories[i].name}" (${i + 1}/${numCategoriesNeeded})...`);
                
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
            
            if (movedCount > 0) {
                await progressMsg.edit(`📦 Moved ${movedCount} journals. Waiting for Discord to process moves...`);
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
                    await message.guild.channels.fetch();
                    
                    // Check if all moves have been processed
                    allMovesConfirmed = true;
                    for (const movedJournal of movedJournals) {
                        const refreshedJournal = message.guild.channels.cache.get(movedJournal.journal.id);
                        if (!refreshedJournal || refreshedJournal.parent?.id !== movedJournal.targetCategory.id) {
                            allMovesConfirmed = false;
                            break;
                        }
                    }
                    
                    attempts++;
                    if (!allMovesConfirmed) {
                        console.log(`⏳ Waiting for Discord to process journal moves... (attempt ${attempts}/${maxAttempts})`);
                        await progressMsg.edit(`⏳ Waiting for Discord to process journal moves... (${attempts}/${maxAttempts} seconds)`);
                    }
                }
                
                if (allMovesConfirmed) {
                    console.log(`✅ All journal moves confirmed, restoring permissions...`);
                    await progressMsg.edit(`🔐 Restoring permissions for ${movedJournals.length} moved journals...`);
                    
                    let restoredCount = 0;
                    // Now restore permissions for all moved journals
                    for (const movedJournal of movedJournals) {
                        try {
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
                                    await movedJournal.journal.permissionOverwrites.edit(id, permissionData);
                                }
                            }
                            restoredCount++;
                            // Update progress every 10 journals or for the first few
                            if (restoredCount <= 5 || restoredCount % 10 === 0 || restoredCount === movedJournals.length) {
                                await progressMsg.edit(`🔐 Restoring permissions... (${restoredCount}/${movedJournals.length} journals)`);
                            }
                            console.log(`✅ Restored permissions for journal channel: ${movedJournal.journal.name}`);
                        } catch (permissionError) {
                            console.error(`⚠️ Warning: Could not restore permissions for journal channel ${movedJournal.journal.name}:`, permissionError);
                        }
                    }
                } else {
                    console.warn(`⚠️ Not all journal moves were confirmed after ${maxAttempts} attempts`);
                    await progressMsg.edit(`⚠️ Not all journal moves were confirmed after ${maxAttempts} attempts. Continuing anyway...`);
                }
            }
            
            // Alphabetize journals within each category
            await progressMsg.edit(`🔤 Alphabetizing journals within each category...`);
            for (let i = 0; i < numCategoriesNeeded; i++) {
                await progressMsg.edit(`🔤 Alphabetizing journals in "${newCategories[i].name}" (${i + 1}/${numCategoriesNeeded})...`);
                await this.alphabetizeJournalsInCategory(message.guild, newCategories[i]);
            }

            // Clean up old empty categories (except the original 'Journals' category)
            await progressMsg.edit(`🧹 Cleaning up empty categories...`);
            for (const category of journalCategories.values()) {
                if (category.name !== 'Journals' && category.children?.cache.size === 0) {
                    await category.delete();
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('📚 Journal Categories Balanced')
                .setDescription(`Successfully reorganized ${totalJournals} journals into ${numCategoriesNeeded} categories.`)
                .addFields(
                    { name: 'Total Journals', value: totalJournals.toString(), inline: true },
                    { name: 'Categories Created', value: numCategoriesNeeded.toString(), inline: true },
                    { name: 'Journals Moved', value: movedCount.toString(), inline: true }
                )
                .setColor(0x00AE86);

            // Add category breakdown
            let categoryBreakdown = '';
            for (let i = 0; i < newCategories.length; i++) {
                const startIndex = i * journalsPerCategory;
                const endIndex = Math.min((i + 1) * journalsPerCategory, totalJournals);
                const startJournal = allJournalChannels[startIndex];
                const endJournal = allJournalChannels[endIndex - 1];
                const startName = startJournal.name.replace('-journal', '').toUpperCase();
                const endName = endJournal.name.replace('-journal', '').toUpperCase();
                const startLetter = startName.charAt(0);
                const endLetter = endName.charAt(0);
                const journalCount = endIndex - startIndex;
                
                categoryBreakdown += `• **${newCategories[i].name}**: ${journalCount} journals (${startLetter}-${endLetter})\n`;
            }
            
            embed.addFields({ name: 'Category Breakdown', value: categoryBreakdown });

            await progressMsg.edit({ embeds: [embed] });

        } catch (error) {
            console.error('Error balancing journals:', error);
            await message.reply('❌ An error occurred while balancing journals.');
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



    async handlePopulateJournals(message, args) {
        if (process.env.NODE_ENV !== 'development') {
            return message.reply('❌ This command is only available in development mode.');
        }

        // Parse number of journals to create (default 50 if not specified)
        let numJournals = 50;
        if (args.length > 0) {
            const parsed = parseInt(args[0]);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
                numJournals = parsed;
            } else {
                return message.reply('❌ Please specify a number between 1 and 100. Usage: `Wolf.populate_journals [number]`');
            }
        }

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
            }

            // Get roles for permissions
            const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');
            const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
            const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');

            const createdChannels = [];
            const failedChannels = [];

            // Create test journals with random letter prefixes for better testing
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            for (let i = 1; i <= numJournals; i++) {
                try {
                    // Generate a random letter prefix
                    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                    const testName = `${randomLetter}TestUser${i.toString().padStart(3, '0')}`;
                    const journalChannelName = `${testName.toLowerCase()}-journal`;

                    // Check if journal already exists
                    const existingJournal = message.guild.channels.cache.find(
                        channel => channel.name === journalChannelName && channel.parent?.id === journalsCategory.id
                    );

                    if (existingJournal) {
                        failedChannels.push(`${testName} (already exists)`);
                        continue;
                    }

                    // Create the journal channel
                    const journalChannel = await message.guild.channels.create({
                        name: journalChannelName,
                        type: ChannelType.GuildText,
                        parent: journalsCategory.id,
                        permissionOverwrites: [
                            {
                                id: message.guild.roles.everyone.id,
                                deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                            },
                            ...(modRole ? [{
                                id: modRole.id,
                                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                                deny: [PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                            }] : []),
                            ...(spectatorRole ? [{
                                id: spectatorRole.id,
                                allow: [PermissionFlagsBits.ViewChannel],
                                deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                            }] : []),
                            ...(deadRole ? [{
                                id: deadRole.id,
                                allow: [PermissionFlagsBits.ViewChannel],
                                deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                            }] : [])
                        ],
                    });

                    // Send initial message to the journal
                    const embed = new EmbedBuilder()
                        .setTitle(`📔 ${testName}'s Journal`)
                        .setDescription(`This is a test journal for ${testName}.\n\nThis journal was created for testing the journal balancing system.`)
                        .setColor(0x8B4513)
                        .setTimestamp();

                    await journalChannel.send({ embeds: [embed] });

                    createdChannels.push(testName);
                    
                    // Add a small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    console.error(`Error creating test journal ${i}:`, error);
                    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                    failedChannels.push(`${randomLetter}TestUser${i.toString().padStart(3, '0')} (error: ${error.message})`);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('🧪 Test Journals Created')
                .setDescription(`Created ${createdChannels.length} test journals for testing the balance system.`)
                .addFields(
                    { name: 'Successfully Created', value: createdChannels.length.toString(), inline: true },
                    { name: 'Failed', value: failedChannels.length.toString(), inline: true },
                    { name: 'Total Requested', value: numJournals.toString(), inline: true }
                )
                .setColor(0x00AE86);

            if (failedChannels.length > 0) {
                embed.addFields({
                    name: 'Failed Journals',
                    value: failedChannels.slice(0, 10).join('\n') + (failedChannels.length > 10 ? `\n... and ${failedChannels.length - 10} more` : ''),
                    inline: false
                });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error populating journals:', error);
            await message.reply('❌ An error occurred while creating test journals.');
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

                    try {
                        await message.guild.members.fetch();
                    } catch (error) {
                        console.log('Could not fetch all guild members, falling back to individual fetches');
                        // Fallback to original method if bulk fetch fails
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

                    // Use cached members for much faster processing
                    for (const player of allPlayers.rows) {
                        const member = message.guild.members.cache.get(player.user_id);
                        if (member && member.roles.cache.has(aliveRole.id)) {
                            aliveCount++;
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

            // Get channel counts (includes queued-to-create from DB for accurate projection)
            const capacity = await this.getServerChannelCapacity(serverId, message.guild);
            const channelUsagePercentage = ((capacity.currentChannelsCount / capacity.channelLimit) * 100).toFixed(1);
            const projectedUsagePercentage = ((capacity.projectedTotal / capacity.channelLimit) * 100).toFixed(1);
            
            // Basic server info
            embed.addFields(
                {
                    name: '📊 Basic Info',
                    value:
                        `**Members:** ${memberCount}\n` +
                        `**Total Games:** ${totalGames}\n` +
                        `**Channels (now):** ${capacity.currentChannelsCount}/${capacity.channelLimit} (${channelUsagePercentage}%)\n` +
                        `**Queued (DB):** ${capacity.pendingToCreateCount}\n` +
                        `**Projected:** ${capacity.projectedTotal}/${capacity.channelLimit} (${projectedUsagePercentage}%)` +
                        (capacity.isWithinLimitProjected ? '' : `\n⚠️ **Over limit by:** ${Math.abs(capacity.remainingProjected)}`),
                    inline: true
                }
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

    async handleArchive(message, args) {
        try {
            // Check if category name was provided
            if (!args || args.length === 0) {
                await message.reply('❌ Please provide a category name. Usage: `Wolf.archive <category-name>` or `Wolf.archive <category1>,<category2>,...`');
                return;
            }

            // Check if OpenSearch is configured
            if (!this.openSearchClient) {
                await message.reply('❌ OpenSearch is not configured. Please set up the required environment variables.');
                return;
            }

            // Parse comma-separated category names
            const input = args.join(' ');
            const categoryNames = input.split(',').map(name => name.trim()).filter(name => name.length > 0);

            if (categoryNames.length === 0) {
                await message.reply('❌ Please provide at least one category name.');
                return;
            }

            const categoryList = categoryNames.length === 1 
                ? `"${categoryNames[0]}"` 
                : `${categoryNames.length} categories: ${categoryNames.map(n => `"${n}"`).join(', ')}`;
            await message.reply(`🗄️ Starting full archive process for ${categoryList}. This may take a while...`);
            
            // Check if S3 is configured for image processing
            if (this.s3Client) {
                await message.channel.send(`🖼️ Image processing enabled - Discord images will be uploaded to S3 bucket 'stinkwolf-images'`);
            } else {
                await message.channel.send(`⚠️ S3 not configured - Discord images will be archived with original URLs (may expire)`);
            }

            // Find all categories by name
            const guild = message.guild;
            const categories = [];
            const notFoundCategories = [];

            for (const categoryName of categoryNames) {
                const category = guild.channels.cache.find(
                    channel => channel.type === ChannelType.GuildCategory && 
                              channel.name.toLowerCase() === categoryName.toLowerCase()
                );

                if (category) {
                    categories.push(category);
                } else {
                    notFoundCategories.push(categoryName);
                }
            }

            if (notFoundCategories.length > 0) {
                await message.reply(`❌ Categories not found: ${notFoundCategories.map(n => `"${n}"`).join(', ')}`);
                if (categories.length === 0) {
                    return;
                }
                await message.channel.send(`⚠️ Continuing with found categories: ${categories.map(c => `"${c.name}"`).join(', ')}`);
            }

            if (categories.length === 0) {
                await message.reply('❌ No valid categories found.');
                return;
            }

            // Collect all channels from all categories
            const allChannels = [];
            const categoryChannelMap = new Map(); // Track which channels belong to which category

            for (const category of categories) {
                const channels = guild.channels.cache.filter(
                    channel => channel.type === ChannelType.GuildText && 
                              channel.parentId === category.id &&
                              !channel.name.toLowerCase().includes('mod-chat')
                );

                if (channels.size > 0) {
                    for (const channel of channels.values()) {
                        allChannels.push(channel);
                        categoryChannelMap.set(channel.id, category);
                    }
                }
            }

            if (allChannels.length === 0) {
                await message.reply(`❌ No valid text channels found in any of the specified categories.`);
                return;
            }

            const archivedAt = new Date().toISOString();
            const archivedBy = {
                userId: message.author.id,
                username: message.author.username,
                displayName: message.member ? message.member.displayName : message.author.username
            };

            let totalMessages = 0;
            let indexedMessages = 0;
            let failedMessages = 0;
            let processedImages = 0;
            
            // Store processed messages for S3 backup
            const processedChannelsData = [];

            // Process each channel
            for (const channel of allChannels) {
                const category = categoryChannelMap.get(channel.id);
                console.log(`Processing channel: ${channel.name} (category: ${category.name})`);
                await message.channel.send(`📂 Processing channel: #${channel.name} (${category.name})...`);

                try {
                    // Fetch all messages from the channel
                    let lastMessageId = null;
                    let fetchedCount = 0;
                    const messagesToIndex = [];

                    while (true) {
                        const options = { limit: 100 };
                        if (lastMessageId) {
                            options.before = lastMessageId;
                        }

                        const messages = await channel.messages.fetch(options);
                        
                        if (messages.size === 0) {
                            break;
                        }

                        // Process each message
                        for (const [messageId, msg] of messages) {
                            // Skip bot messages
                            if (msg.author.bot) continue;

                            // Process Discord images in message content
                            let processedContent = msg.content;
                            if (msg.content && msg.content.includes('cdn.discordapp.com')) {
                                try {
                                    const originalContent = processedContent;
                                    processedContent = await this.processDiscordImages(msg.content, msg.id);
                                    // Count processed images by comparing content
                                    if (processedContent !== originalContent) {
                                        const imageMatches = (originalContent.match(/https:\/\/cdn\.discordapp\.com\/attachments\/\d+\/\d+\/[^\s]+/g) || []).length;
                                        processedImages += imageMatches;
                                    }
                                } catch (error) {
                                    console.error(`Error processing images in message ${msg.id}:`, error);
                                    // Keep original content if processing fails
                                }
                            }

                            // Process attachments (Discord images)
                            let processedAttachments = [];
                            if (msg.attachments.size > 0) {
                                let attachmentIndex = 0;
                                for (const attachment of msg.attachments.values()) {
                                    let imageBuffer = null;
                                    try {
                                        // Check if it's a Discord CDN image
                                        if (attachment.url && attachment.url.includes('cdn.discordapp.com')) {
                                            // Download and upload to S3 (no disk storage)
                                            imageBuffer = await this.downloadImage(attachment.url);
                                            const s3Url = await this.uploadImageToS3(imageBuffer, attachment.url, msg.id, attachmentIndex);
                                            
                                            processedAttachments.push({
                                                id: attachment.id,
                                                name: attachment.name,
                                                url: s3Url, // Use S3 URL instead of Discord URL
                                                originalUrl: attachment.url, // Keep original for reference
                                                size: attachment.size
                                            });
                                            
                                            processedImages++;
                                            attachmentIndex++;
                                        } else {
                                            // Keep non-Discord attachments as-is
                                            processedAttachments.push({
                                                id: attachment.id,
                                                name: attachment.name,
                                                url: attachment.url,
                                                size: attachment.size
                                            });
                                            attachmentIndex++;
                                        }
                                    } catch (error) {
                                        console.error(`Error processing attachment ${attachment.url}:`, error);
                                        // Keep original attachment if processing fails
                                        processedAttachments.push({
                                            id: attachment.id,
                                            name: attachment.name,
                                            url: attachment.url,
                                            size: attachment.size
                                        });
                                    } finally {
                                        // Explicitly clear the buffer from memory
                                        if (imageBuffer) {
                                            imageBuffer = null;
                                        }
                                    }
                                }
                            }

                            const messageData = {
                                messageId: msg.id,
                                content: processedContent,
                                userId: msg.author.id,
                                username: msg.author.username,
                                displayName: msg.member ? msg.member.displayName : msg.author.username,
                                timestamp: msg.createdAt.toISOString(),
                                channelId: msg.channel.id,
                                channelName: msg.channel.name,
                                categoryId: category.id,
                                category: category.name,
                                replyToMessageId: msg.reference ? msg.reference.messageId : null,
                                attachments: processedAttachments,
                                embeds: msg.embeds.length > 0 ? 
                                    msg.embeds.map(embed => ({
                                        title: embed.title,
                                        description: embed.description,
                                        url: embed.url
                                    })) : [],
                                reactions: msg.reactions.cache.size > 0 ? 
                                    msg.reactions.cache.map(reaction => ({
                                        emoji: reaction.emoji.name,
                                        count: reaction.count
                                    })) : [],
                                archivedAt: archivedAt,
                                archivedBy: archivedBy,
                                contentLength: processedContent.length,
                                hasAttachments: processedAttachments.length > 0,
                                hasEmbeds: msg.embeds.length > 0,
                                hasReactions: msg.reactions.cache.size > 0,
                                isReply: msg.reference ? true : false
                            };

                            messagesToIndex.push(messageData);
                            fetchedCount++;
                        }

                        lastMessageId = messages.last().id;
                        
                        // Rate limiting to avoid Discord API limits
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    console.log(`Fetched ${fetchedCount} messages from ${channel.name}`);
                    totalMessages += fetchedCount;
                    
                    // Store processed messages for S3 backup (reuse the data we already have)
                    processedChannelsData.push({
                        channelName: channel.name,
                        categoryName: category.name,
                        categoryId: category.id,
                        messageCount: messagesToIndex.length,
                        messages: messagesToIndex.map(msg => ({
                            messageId: msg.messageId,
                            content: msg.content,
                            userId: msg.userId,
                            username: msg.username,
                            displayName: msg.displayName,
                            timestamp: msg.timestamp,
                            channelId: msg.channelId,
                            channelName: msg.channelName,
                            replyToMessageId: msg.replyToMessageId,
                            attachments: msg.attachments,
                            embeds: msg.embeds,
                            reactions: msg.reactions
                        }))
                    });

                    // Index messages in batches to OpenSearch
                    if (messagesToIndex.length > 0) {
                        const batchSize = 100;
                        for (let i = 0; i < messagesToIndex.length; i += batchSize) {
                            const batch = messagesToIndex.slice(i, i + batchSize);
                            
                            try {
                                const bulkBody = [];
                                for (const msg of batch) {
                                    bulkBody.push({ index: { _index: 'messages' } });
                                    bulkBody.push(msg);
                                }

                                const response = await this.openSearchClient.bulk({
                                    body: bulkBody
                                });

                                // Check for errors in bulk response
                                if (response.body.errors) {
                                    const errors = response.body.items.filter(item => item.index && item.index.error);
                                    failedMessages += errors.length;
                                    indexedMessages += batch.length - errors.length;
                                    
                                    if (errors.length > 0) {
                                        console.error(`Failed to index ${errors.length} messages in batch:`, errors);
                                    }
                                } else {
                                    indexedMessages += batch.length;
                                }

                                // Rate limiting for OpenSearch
                                await new Promise(resolve => setTimeout(resolve, 50));

                            } catch (bulkError) {
                                console.error(`Error indexing batch for channel ${channel.name}:`, bulkError);
                                failedMessages += batch.length;
                            }
                        }
                    }

                } catch (channelError) {
                    console.error(`Error processing channel ${channel.name}:`, channelError);
                    await message.channel.send(`⚠️ Error processing channel #${channel.name}: ${channelError.message}`);
                }
            }

            // Create full archive JSON file for S3 (disaster recovery backup)
            // Create one file per category for easier management
            if (this.s3Client && process.env.AWS_S3_BUCKET_NAME) {
                try {
                    console.log('📦 Creating full archive backup for disaster recovery...');
                    
                    for (const category of categories) {
                        // Filter channels for this category
                        const categoryChannels = processedChannelsData.filter(
                            ch => ch.categoryId === category.id
                        );

                        if (categoryChannels.length === 0) {
                            continue; // Skip if no channels for this category
                        }

                        const archiveData = {
                            category: category.name,
                            categoryId: category.id,
                            archivedAt: archivedAt,
                            archivedBy: archivedBy,
                            channels: categoryChannels
                        };

                        // Create filename using category name and ID for consistent overwriting
                        const safeCategoryName = category.name.replace(/[^a-zA-Z0-9]/g, '_');
                        const filename = `${safeCategoryName}_${category.id}.json`;
                        const jsonContent = JSON.stringify(archiveData, null, 2);

                        const uploadParams = {
                            Bucket: process.env.AWS_S3_BUCKET_NAME,
                            Key: `archives/${filename}`,
                            Body: jsonContent,
                            ContentType: 'application/json'
                        };

                        await this.s3Client.send(new PutObjectCommand(uploadParams));
                        
                        await message.channel.send(`☁️ Full archive backup uploaded to S3: \`${filename}\` (${category.name})`);
                    }
                } catch (s3Error) {
                    console.error('Error uploading archive to S3:', s3Error);
                }
            }

            // Send completion message
            const categoriesList = categories.map(c => `"${c.name}"`).join(', ');
            const embed = new EmbedBuilder()
                .setTitle('✅ Archive Complete')
                .setDescription(`Successfully archived ${categories.length === 1 ? 'category' : 'categories'}: ${categoriesList} to OpenSearch`)
                .addFields(
                    { name: 'Categories Processed', value: categories.length.toString(), inline: true },
                    { name: 'Channels Processed', value: allChannels.length.toString(), inline: true },
                    { name: 'Total Messages', value: totalMessages.toString(), inline: true },
                    { name: 'Indexed Messages', value: indexedMessages.toString(), inline: true },
                    { name: 'Failed Messages', value: failedMessages.toString(), inline: true },
                    { name: 'Images Processed', value: processedImages.toString(), inline: true },
                    { name: 'Backup Type', value: 'Full Archive (Disaster Recovery)', inline: true },
                    { name: 'Storage', value: 'OpenSearch + S3', inline: true }
                )
                .setColor(0x00AE86)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error handling archive command:', error);
            await message.reply('❌ An error occurred while processing the archive command.');
        }
    }

    /**
     * Handle archive local command - saves game data as JSON file locally (development only)
     */
    async handleArchiveLocal(message, args) {
        try {
            // Only allow in development mode
            if (process.env.NODE_ENV === 'production') {
                await message.reply('❌ This command is only available in development mode.');
                return;
            }

            // Check if category name was provided
            if (!args || args.length === 0) {
                await message.reply('❌ Please provide a category name. Usage: `Wolf.archive_local <category-name>`');
                return;
            }

            const categoryName = args.join(' ');
            await message.reply(`🗄️ Starting local archive process for category: "${categoryName}". This may take a while...`);

            // Find the category by name
            const guild = message.guild;
            const category = guild.channels.cache.find(
                channel => channel.type === ChannelType.GuildCategory && 
                          channel.name.toLowerCase() === categoryName.toLowerCase()
            );

            if (!category) {
                await message.reply(`❌ Category "${categoryName}" not found.`);
                return;
            }

            // Get all text channels in the category, excluding mod-chat channels
            const channels = guild.channels.cache.filter(
                channel => channel.type === ChannelType.GuildText && 
                          channel.parentId === category.id &&
                          !channel.name.toLowerCase().includes('mod-chat')
            );

            if (channels.size === 0) {
                await message.reply(`❌ No valid text channels found in category "${categoryName}".`);
                return;
            }

            const archivedAt = new Date().toISOString();
            const archivedBy = {
                userId: message.author.id,
                username: message.author.username,
                displayName: message.member ? message.member.displayName : message.author.username
            };

            let totalMessages = 0;
            let processedImages = 0;
            
            // Store processed messages for local JSON file
            const processedChannelsData = [];

            // Process each channel
            for (const [channelId, channel] of channels) {
                console.log(`Processing channel: ${channel.name}`);
                await message.channel.send(`📂 Processing channel: #${channel.name}...`);

                try {
                    // Fetch all messages from the channel
                    let lastMessageId = null;
                    let fetchedCount = 0;
                    const messagesToArchive = [];

                    while (true) {
                        const options = { limit: 100 };
                        if (lastMessageId) {
                            options.before = lastMessageId;
                        }

                        const messages = await channel.messages.fetch(options);
                        
                        if (messages.size === 0) {
                            break;
                        }

                        // Process each message
                        for (const [messageId, msg] of messages) {
                            // Skip bot messages
                            if (msg.author.bot) continue;

                            // Process Discord images in message content (keep original URLs for local archive)
                            let processedContent = msg.content;
                            if (msg.content && msg.content.includes('cdn.discordapp.com')) {
                                // Count images but keep original URLs for local archive
                                const imageMatches = (msg.content.match(/https:\/\/cdn\.discordapp\.com\/attachments\/\d+\/\d+\/[^\s]+/g) || []);
                                processedImages += imageMatches.length;
                            }

                            // Process attachments (keep original URLs for local archive)
                            let processedAttachments = [];
                            if (msg.attachments.size > 0) {
                                for (const attachment of msg.attachments.values()) {
                                    processedAttachments.push({
                                        id: attachment.id,
                                        name: attachment.name,
                                        url: attachment.url, // Keep original Discord URL
                                        size: attachment.size
                                    });
                                    
                                    if (attachment.url && attachment.url.includes('cdn.discordapp.com')) {
                                        processedImages++;
                                    }
                                }
                            }

                            const messageData = {
                                messageId: msg.id,
                                content: processedContent,
                                userId: msg.author.id,
                                username: msg.author.username,
                                displayName: msg.member ? msg.member.displayName : msg.author.username,
                                timestamp: msg.createdAt.toISOString(),
                                channelId: msg.channel.id,
                                channelName: msg.channel.name,
                                categoryId: category.id,
                                category: category.name,
                                replyToMessageId: msg.reference ? msg.reference.messageId : null,
                                attachments: processedAttachments,
                                embeds: msg.embeds.length > 0 ? 
                                    msg.embeds.map(embed => ({
                                        title: embed.title,
                                        description: embed.description,
                                        url: embed.url
                                    })) : [],
                                reactions: msg.reactions.cache.size > 0 ? 
                                    msg.reactions.cache.map(reaction => ({
                                        emoji: reaction.emoji.name,
                                        count: reaction.count
                                    })) : [],
                                archivedAt: archivedAt,
                                archivedBy: archivedBy,
                                contentLength: processedContent.length,
                                hasAttachments: processedAttachments.length > 0,
                                hasEmbeds: msg.embeds.length > 0,
                                hasReactions: msg.reactions.cache.size > 0,
                                isReply: msg.reference ? true : false
                            };

                            messagesToArchive.push(messageData);
                            fetchedCount++;
                        }

                        lastMessageId = messages.last().id;
                        
                        // Rate limiting to avoid Discord API limits
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    console.log(`Fetched ${fetchedCount} messages from ${channel.name}`);
                    totalMessages += fetchedCount;
                    
                    // Store processed messages for local JSON file
                    processedChannelsData.push({
                        channelName: channel.name,
                        messageCount: messagesToArchive.length,
                        messages: messagesToArchive.map(msg => ({
                            messageId: msg.messageId,
                            content: msg.content,
                            userId: msg.userId,
                            username: msg.username,
                            displayName: msg.displayName,
                            timestamp: msg.timestamp,
                            channelId: msg.channelId,
                            channelName: msg.channelName,
                            replyToMessageId: msg.replyToMessageId,
                            attachments: msg.attachments,
                            embeds: msg.embeds,
                            reactions: msg.reactions
                        }))
                    });

                } catch (channelError) {
                    console.error(`Error processing channel ${channel.name}:`, channelError);
                    await message.channel.send(`⚠️ Error processing channel #${channel.name}: ${channelError.message}`);
                }
            }

            // Create local archive JSON file
            try {
                console.log('📦 Creating local archive JSON file...');
                
                const archiveData = {
                    category: categoryName,
                    categoryId: category.id,
                    archivedAt: archivedAt,
                    archivedBy: archivedBy,
                    channels: processedChannelsData,
                    metadata: {
                        totalChannels: channels.size,
                        totalMessages: totalMessages,
                        processedImages: processedImages,
                        archiveType: 'local_development',
                        nodeEnv: process.env.NODE_ENV
                    }
                };

                // Create filename using category name and ID
                const safeCategoryName = categoryName.replace(/[^a-zA-Z0-9]/g, '_');
                const filename = `archive_${safeCategoryName}_${category.id}_${Date.now()}.json`;
                const filePath = `./data/${filename}`;
                
                // Ensure data directory exists
                const fs = require('fs');
                const path = require('path');
                const dataDir = './data';
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }

                // Write JSON file
                const jsonContent = JSON.stringify(archiveData, null, 2);
                fs.writeFileSync(filePath, jsonContent, 'utf8');
                
                await message.channel.send(`💾 Local archive saved: \`${filename}\` (${(jsonContent.length / 1024 / 1024).toFixed(2)} MB)`);
                
            } catch (fileError) {
                console.error('Error creating local archive file:', fileError);
                await message.channel.send(`❌ Error creating local archive file: ${fileError.message}`);
            }

            // Send completion message
            const embed = new EmbedBuilder()
                .setTitle('✅ Local Archive Complete')
                .setDescription(`**Done!** The archive has been successfully saved locally as a JSON file.`)
                .addFields(
                    { name: 'Channels Processed', value: channels.size.toString(), inline: true },
                    { name: 'Total Messages', value: totalMessages.toString(), inline: true },
                    { name: 'Images Found', value: processedImages.toString(), inline: true },
                    { name: 'Archive Type', value: 'Local Development', inline: true },
                    { name: 'Storage Location', value: 'Local JSON File in ./data/', inline: true },
                    { name: 'Environment', value: process.env.NODE_ENV || 'development', inline: true }
                )
                .setColor(0x00AE86)
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error handling archive_local command:', error);
            await message.reply('❌ An error occurred while processing the archive_local command.');
        }
    }

    /**
     * Handle manual sync members command
     */
    async handleSyncMembers(message) {
        try {
            await message.reply('🔄 Starting manual server member sync... This may take a few moments.');
            
            // Call the sync method
            await this.syncServerMembers();
            
            await message.reply('✅ Manual server member sync completed!');
            
        } catch (error) {
            console.error('Error handling manual sync members command:', error);
            await message.reply('❌ An error occurred while processing the sync command.');
        }
    }

    /**
     * Handle role configuration command
     */
    async handleRoleConfiguration(message) {
        if (this.isPublicChannel(message)) {
            return message.reply('WOAH! You trying to scuff the game? Wrong channel buddy!');
        }

        try {
            // Get the current game for this server
            const gameQuery = `
                SELECT id, game_number, game_name, status 
                FROM games 
                WHERE server_id = $1 AND status IN ('signup', 'active') 
                ORDER BY id DESC 
                LIMIT 1
            `;
            
            const gameResult = await this.db.query(gameQuery, [message.guild.id]);
            
            if (gameResult.rows.length === 0) {
                await message.reply('❌ No active game found for this server.');
                return;
            }
            
            const game = gameResult.rows[0];
            
            // Get role configuration for this game
            const roleQuery = `
                SELECT gr.*, r.name as role_name, r.team as role_team, r.has_charges, r.default_charges, r.has_win_by_number, r.default_win_by_number, r.in_wolf_chat
                FROM game_role gr 
                JOIN roles r ON gr.role_id = r.id 
                WHERE gr.game_id = $1
                ORDER BY r.team, r.name
            `;
            
            const roleResult = await this.db.query(roleQuery, [game.id]);
            
            if (roleResult.rows.length === 0) {
                await message.reply('❌ No role configuration found for the current game.');
                return;
            }
            
            // Group roles by team and sort alphabetically
            const townRoles = [];
            const wolfRoles = [];
            const neutralRoles = [];
            
            roleResult.rows.forEach(row => {
                const roleInfo = {
                    name: row.custom_name || row.role_name,
                    count: row.role_count,
                    charges: row.charges || 0,
                    winByNumber: row.win_by_number || 0,
                    hasCharges: row.has_charges,
                    hasWinByNumber: row.has_win_by_number
                };
                
                switch (row.role_team) {
                    case 'town':
                        townRoles.push(roleInfo);
                        break;
                    case 'wolf':
                        wolfRoles.push(roleInfo);
                        break;
                    case 'neutral':
                        neutralRoles.push(roleInfo);
                        break;
                }
            });
            
            // Sort each team alphabetically
            townRoles.sort((a, b) => a.name.localeCompare(b.name));
            wolfRoles.sort((a, b) => a.name.localeCompare(b.name));
            neutralRoles.sort((a, b) => a.name.localeCompare(b.name));
            
            // Build the embed
            const embed = new EmbedBuilder()
                .setTitle(`🎭 Role Configuration - Game ${game.game_number}`)
                .setColor(0x0099ff)
                .setTimestamp();
            
            if (game.game_name) {
                embed.setDescription(`**${game.game_name}**`);
            }
            
            // Add town roles
            if (townRoles.length > 0) {
                let townText = '';
                townRoles.forEach(role => {
                    let roleText = `• **${role.name}`;
                    if (role.count > 1) {
                        roleText += ` (${role.count})`;
                    }
                    roleText += '**';
                    if (role.hasCharges && role.charges > 0) {
                        roleText += ` - ${role.charges} charges`;
                    }
                    if (role.hasWinByNumber && role.winByNumber > 0) {
                        roleText += ` - Win by ${role.winByNumber}`;
                    }
                    townText += roleText + '\n';
                });
                embed.addFields({ name: '🏘️ Town', value: townText, inline: false });
            }
            
            // Add wolf roles
            if (wolfRoles.length > 0) {
                let wolfText = '';
                wolfRoles.forEach(role => {
                    let roleText = `• **${role.name}`;
                    if (role.count > 1) {
                        roleText += ` (${role.count})`;
                    }
                    roleText += '**';
                    if (role.hasCharges && role.charges > 0) {
                        roleText += ` - ${role.charges} charges`;
                    }
                    if (role.hasWinByNumber && role.winByNumber > 0) {
                        roleText += ` - Win by ${role.winByNumber}`;
                    }
                    wolfText += roleText + '\n';
                });
                embed.addFields({ name: '🐺 Wolves', value: wolfText, inline: false });
            }
            
            // Add neutral roles
            if (neutralRoles.length > 0) {
                let neutralText = '';
                neutralRoles.forEach(role => {
                    let roleText = `• **${role.name}`;
                    if (role.count > 1) {
                        roleText += ` (${role.count})`;
                    }
                    roleText += '**';
                    if (role.hasCharges && role.charges > 0) {
                        roleText += ` - ${role.charges} charges`;
                    }
                    if (role.hasWinByNumber && role.winByNumber > 0) {
                        roleText += ` - Win by ${role.winByNumber}`;
                    }
                    neutralText += roleText + '\n';
                });
                embed.addFields({ name: '⚖️ Neutrals', value: neutralText, inline: false });
            }
            
            // Add summary
            const totalCount = roleResult.rows.reduce((sum, row) => sum + row.role_count, 0);
            
            embed.addFields({ 
                name: '📊 Summary', 
                value: `${totalCount} Selected Roles`, 
                inline: false 
            });
            
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error handling role configuration command:', error);
            await message.reply('❌ An error occurred while fetching the role configuration.');
        }
    }

    /**
     * Handle channel configuration command
     */
    async handleChannelConfig(message) {
        if (this.isPublicChannel(message)) {
            return message.reply('WOAH! You trying to scuff the game? Wrong channel buddy!');
        }

        try {
            // Get the current game for this server
            const gameQuery = `
                SELECT id, game_number, game_name, status 
                FROM games 
                WHERE server_id = $1 AND status IN ('signup', 'active') 
                ORDER BY id DESC 
                LIMIT 1
            `;
            
            const gameResult = await this.db.query(gameQuery, [message.guild.id]);
            
            if (gameResult.rows.length === 0) {
                await message.reply('❌ No active game found for this server.');
                return;
            }
            
            const game = gameResult.rows[0];
            
            // Get all channels for this game
            const channelQuery = `
                SELECT channel_name, is_created, invited_users, open_at_dawn, open_at_dusk, is_couple_chat
                FROM game_channels 
                WHERE game_id = $1
                ORDER BY channel_name
            `;
            
            const channelResult = await this.db.query(channelQuery, [game.id]);
            
            if (channelResult.rows.length === 0) {
                await message.reply('❌ No channels configured for the current game.');
                return;
            }
            
            // Get all players for user ID to username mapping
            const playersResult = await this.db.query(
                'SELECT user_id, username FROM players WHERE game_id = $1',
                [game.id]
            );
            
            const userIdToUsername = new Map();
            playersResult.rows.forEach(player => {
                userIdToUsername.set(player.user_id, player.username);
            });
            
            // Build the embed
            const embed = new EmbedBuilder()
                .setTitle(`📁 Channel Configuration - Game ${game.game_number}`)
                .setColor(0x0099ff)
                .setTimestamp();
            
            if (game.game_name) {
                embed.setDescription(`**${game.game_name}**`);
            }
            
            // Process each channel
            for (const channel of channelResult.rows) {
                let channelText = '';
                
                // Status
                const status = channel.is_created ? '✅ Created' : '⏳ Pending';
                channelText += `**Status:** ${status}\n`;
                
                // Open flags
                const openFlags = [];
                if (channel.open_at_dawn) openFlags.push('Dawn');
                if (channel.open_at_dusk) openFlags.push('Dusk');
                if (openFlags.length > 0) {
                    channelText += `**Open at:** ${openFlags.join(', ')}\n`;
                }
                
                // Couple chat flag
                if (channel.is_couple_chat) {
                    channelText += `**Type:** Couple Chat\n`;
                }
                
                // Invited users
                if (channel.invited_users && Array.isArray(channel.invited_users) && channel.invited_users.length > 0) {
                    const usernames = [];
                    const unknownUsers = [];
                    
                    for (const userId of channel.invited_users) {
                        const username = userIdToUsername.get(userId);
                        if (username) {
                            usernames.push(username);
                        } else {
                            unknownUsers.push(userId);
                        }
                    }
                    
                    if (usernames.length > 0) {
                        channelText += `**Invited Players:** ${usernames.join(', ')}\n`;
                    }
                    if (unknownUsers.length > 0) {
                        channelText += `**Unknown Users:** ${unknownUsers.join(', ')}\n`;
                    }
                } else {
                    channelText += `**Invited Players:** None\n`;
                }
                
                embed.addFields({ 
                    name: `#${channel.channel_name}`, 
                    value: channelText, 
                    inline: false 
                });
            }
            
            // Add summary
            const createdCount = channelResult.rows.filter(c => c.is_created).length;
            const pendingCount = channelResult.rows.filter(c => !c.is_created).length;
            
            embed.addFields({ 
                name: '📊 Summary', 
                value: `Total: ${channelResult.rows.length} channels\n✅ Created: ${createdCount}\n⏳ Pending: ${pendingCount}`, 
                inline: false 
            });
            
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error handling channel configuration command:', error);
            await message.reply('❌ An error occurred while fetching the channel configuration.');
        }
    }

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

    async handleLockdown(message, args) {
        const serverId = message.guild.id;
        
        try {
            // Get the active game
            const activeGameResult = await this.db.query(
                'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3) ORDER BY id DESC LIMIT 1',
                [serverId, 'signup', 'active']
            );

            if (activeGameResult.rows.length === 0) {
                await message.reply('❌ No active game found for this server.');
                return;
            }

            const game = activeGameResult.rows[0];
            
            // Get the alive role
            const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');

            if (!aliveRole) {
                await message.reply('❌ Could not find the alive role for this server.');
                return;
            }

            // Check if this is a lift command
            if (args.length > 0 && args[0].toLowerCase() === 'lift') {
                // Lift lockdown - restore normal permissions
                await this.setChannelPermissions(game, aliveRole, true, message);
                
                // Send lift message to townsquare
                if (game.town_square_channel_id) {
                    try {
                        const townSquareChannel = await this.client.channels.fetch(game.town_square_channel_id);
                        if (townSquareChannel) {
                            await townSquareChannel.send('🔓 **Lockdown has been lifted, enjoy your time in the yard**');
                        }
                    } catch (error) {
                        console.error('Error sending lift message to townsquare:', error);
                    }
                }
                
                await message.reply('🔓 Lockdown lifted! Players can now speak in townsquare and memos.');
            } else {
                // Apply lockdown - restrict message permissions
                await this.setChannelPermissions(game, aliveRole, false, message);
                
                // Send lockdown message to townsquare
                if (game.town_square_channel_id) {
                    try {
                        const townSquareChannel = await this.client.channels.fetch(game.town_square_channel_id);
                        if (townSquareChannel) {
                            await townSquareChannel.send('🔒 **Lockdown!** Looks like the inmates were getting too rowdy');
                        }
                    } catch (error) {
                        console.error('Error sending lockdown message to townsquare:', error);
                    }
                }
                
                await message.reply('🔒 Lockdown applied! Players can no longer speak in townsquare and memos.');
            }
            
        } catch (error) {
            console.error('Error handling lockdown command:', error);
            await message.reply('❌ An error occurred while processing the lockdown command.');
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

    /**
     * Handle feedback command - allows users to submit feedback
     */
    async handleFeedback(message, args) {
        try {
            // Check if feedback text was provided
            if (args.length === 0) {
                await message.reply('Please provide feedback text. Usage: `' + this.prefix + 'feedback <your feedback message>`');
                return;
            }

            const feedbackText = args.join(' ').trim();
            
            // Validate feedback length
            if (feedbackText.length > 2000) {
                await message.reply('Feedback is too long. Please keep it under 2000 characters.');
                return;
            }

            if (feedbackText.length < 3) {
                await message.reply('Feedback is too short. Please provide more details.');
                return;
            }

            // Get user information
            const userId = message.author.id;
            const displayName = message.member?.displayName || message.author.username;
            const serverId = message.guild.id;

            // Insert feedback into database using parameterized query to prevent SQL injection
            const query = `
                INSERT INTO feedback (user_id, display_name, feedback_text, server_id) 
                VALUES ($1, $2, $3, $4) 
                RETURNING id, created_at
            `;
            
            const result = await this.db.query(query, [userId, displayName, feedbackText, serverId]);
            
            if (result.rows.length > 0) {
                const feedbackId = result.rows[0].id;
                const createdAt = result.rows[0].created_at;
                
                // Send confirmation message
                const embed = new EmbedBuilder()
                    .setTitle('✅ Feedback Submitted')
                    .setDescription(`Thank you for your feedback, ${displayName}!`)
                    .setColor(0x00AE86)
                    .setFooter({ text: 'Your feedback has been recorded and will be reviewed by that lazy bum Stinky.' });

                await message.reply({ embeds: [embed] });
                
                console.log(`Feedback submitted by ${displayName} (${userId}) in server ${serverId}: ${feedbackText.substring(0, 100)}...`);
            } else {
                throw new Error('Failed to insert feedback into database');
            }

        } catch (error) {
            console.error('Error handling feedback command:', error);
            await message.reply('Sorry, there was an error submitting your feedback. Please try again later.');
        }
    }

}

module.exports = WerewolfBot;
