'use strict';

const { EmbedBuilder } = require('discord.js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Client } = require('@opensearch-project/opensearch');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const fs = require('fs');
const crypto = require('crypto');

module.exports = {

async handleArchive(message, args) {
    try {
        // Check if category name was provided
        if (!args || args.length === 0) {
            await message.reply('❌ Please provide a category name. Usage: `Wolf.archive <category-name>` or `Wolf.archive <category1>,<category2>,...`');
            return;
        }

        // Archive uses the database (no OpenSearch required)

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

                // Insert messages in batches into the database
                if (messagesToIndex.length > 0) {
                    const batchSize = 100;
                    for (let i = 0; i < messagesToIndex.length; i += batchSize) {
                        const batch = messagesToIndex.slice(i, i + batchSize);
                        
                        try {
                            const client = await this.db.connect();
                            try {
                                for (const msg of batch) {
                                    await client.query(
                                        `INSERT INTO archive_messages (
                                            message_id, content, user_id, username, display_name,
                                            timestamp, channel_id, channel_name, category_id, category,
                                            reply_to_message_id, attachments, embeds, reactions,
                                            archived_at, archived_by, content_length,
                                            has_attachments, has_embeds, has_reactions, is_reply
                                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                                        ON CONFLICT (message_id) DO UPDATE SET
                                            content = EXCLUDED.content,
                                            display_name = EXCLUDED.display_name,
                                            attachments = EXCLUDED.attachments,
                                            embeds = EXCLUDED.embeds,
                                            reactions = EXCLUDED.reactions,
                                            archived_at = EXCLUDED.archived_at,
                                            archived_by = EXCLUDED.archived_by`,
                                        [
                                            msg.messageId,
                                            msg.content || null,
                                            msg.userId,
                                            msg.username,
                                            msg.displayName || null,
                                            msg.timestamp,
                                            msg.channelId,
                                            msg.channelName,
                                            msg.categoryId,
                                            msg.category,
                                            msg.replyToMessageId || null,
                                            JSON.stringify(msg.attachments || []),
                                            JSON.stringify(msg.embeds || []),
                                            JSON.stringify(msg.reactions || []),
                                            msg.archivedAt,
                                            JSON.stringify(msg.archivedBy || {}),
                                            msg.contentLength || 0,
                                            msg.hasAttachments || false,
                                            msg.hasEmbeds || false,
                                            msg.hasReactions || false,
                                            msg.isReply || false
                                        ]
                                    );
                                }
                                indexedMessages += batch.length;
                            } finally {
                                client.release();
                            }
                            await new Promise(resolve => setTimeout(resolve, 50));
                        } catch (bulkError) {
                            console.error(`Error inserting batch for channel ${channel.name}:`, bulkError);
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
            .setDescription(`Successfully archived ${categories.length === 1 ? 'category' : 'categories'}: ${categoriesList} to database`)
            .addFields(
                { name: 'Categories Processed', value: categories.length.toString(), inline: true },
                { name: 'Channels Processed', value: allChannels.length.toString(), inline: true },
                { name: 'Total Messages', value: totalMessages.toString(), inline: true },
                { name: 'Indexed Messages', value: indexedMessages.toString(), inline: true },
                { name: 'Failed Messages', value: failedMessages.toString(), inline: true },
                { name: 'Images Processed', value: processedImages.toString(), inline: true },
                { name: 'Backup Type', value: 'Full Archive (Disaster Recovery)', inline: true },
                { name: 'Storage', value: this.s3Client && process.env.AWS_S3_BUCKET_NAME ? 'Database + S3' : 'Database', inline: true }
            )
            .setColor(0x00AE86)
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error handling archive command:', error);
        await message.reply('❌ An error occurred while processing the archive command.');
    }
},

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
},

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
},

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
},

};
