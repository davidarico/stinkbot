'use strict';

const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {

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
},

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
                },
                {
                    id: deadRole.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
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
},

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
},

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
},

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
},

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
},

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
},

};
