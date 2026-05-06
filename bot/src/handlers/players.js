'use strict';

const { EmbedBuilder } = require('discord.js');

module.exports = {

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
},

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
},

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
},

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
},

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
},

};
