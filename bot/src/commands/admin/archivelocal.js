const { ChannelType, EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
    name: 'archive_local',
    playerCommand: false,
    async execute(bot, message, args) {
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
};
