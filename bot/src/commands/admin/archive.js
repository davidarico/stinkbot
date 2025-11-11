const { ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'archive',
    playerCommand: false,
    async execute(bot, message, args) {
            try {
                // Check if category name was provided
                if (!args || args.length === 0) {
                    await message.reply('❌ Please provide a category name. Usage: `Wolf.archive <category-name>`');
                    return;
                }

                // Check if OpenSearch is configured
                if (!bot.openSearchClient) {
                    await message.reply('❌ OpenSearch is not configured. Please set up the required environment variables.');
                    return;
                }

                const categoryName = args.join(' ');
                await message.reply(`🗄️ Starting full archive process for category: "${categoryName}". This may take a while...`);
                
                // Check if S3 is configured for image processing
                if (bot.s3Client) {
                    await message.channel.send(`🖼️ Image processing enabled - Discord images will be uploaded to S3 bucket 'stinkwolf-images'`);
                } else {
                    await message.channel.send(`⚠️ S3 not configured - Discord images will be archived with original URLs (may expire)`);
                }

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
                let indexedMessages = 0;
                let failedMessages = 0;
                let processedImages = 0;
                
                // Store processed messages for S3 backup
                const processedChannelsData = [];

                // Process each channel
                for (const [channelId, channel] of channels) {
                    console.log(`Processing channel: ${channel.name}`);
                    await message.channel.send(`📂 Processing channel: #${channel.name}...`);

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
                                        processedContent = await bot.processDiscordImages(msg.content, msg.id);
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
                                                imageBuffer = await bot.downloadImage(attachment.url);
                                                const s3Url = await bot.uploadImageToS3(imageBuffer, attachment.url, msg.id, attachmentIndex);
                                                
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

                                    const response = await bot.openSearchClient.bulk({
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
                let s3Url = null;
                if (bot.s3Client && process.env.AWS_S3_BUCKET_NAME) {
                    try {
                        console.log('📦 Creating full archive backup for disaster recovery...');
                        
                        // Use the already processed messages (no need to re-fetch!)
                        const archiveData = {
                            category: categoryName,
                            categoryId: category.id,
                            archivedAt: archivedAt,
                            archivedBy: archivedBy,
                            channels: processedChannelsData
                        };

                        // Create filename using category name and ID for consistent overwriting
                        const safeCategoryName = categoryName.replace(/[^a-zA-Z0-9]/g, '_');
                        const filename = `${safeCategoryName}_${category.id}.json`;
                        const jsonContent = JSON.stringify(archiveData, null, 2);

                        const uploadParams = {
                            Bucket: process.env.AWS_S3_BUCKET_NAME,
                            Key: `archives/${filename}`,
                            Body: jsonContent,
                            ContentType: 'application/json'
                        };

                        await bot.s3Client.send(new PutObjectCommand(uploadParams));
                        s3Url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/archives/${filename}`;
                        
                        await message.channel.send(`☁️ Full archive backup uploaded to S3: \`${filename}\` (disaster recovery backup)`);
                    } catch (s3Error) {
                        console.error('Error uploading archive to S3:', s3Error);
                    }
                }

                // Send completion message
                const embed = new EmbedBuilder()
                    .setTitle('✅ Archive Complete')
                    .setDescription(`Successfully archived category: "${categoryName}" to OpenSearch`)
                    .addFields(
                        { name: 'Channels Processed', value: channels.size.toString(), inline: true },
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
};
