'use strict';

const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {

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
},

hasModeratorPermissions(member) {
    return member.permissions.has(PermissionFlagsBits.ManageChannels) ||
           member.permissions.has(PermissionFlagsBits.Administrator);
},

hasTownCouncilRole(member) {
    return member.roles.cache.some(r => r.name === 'Town Council');
},

async handleMod(message, args) {
    const targetMember = message.mentions?.members?.first?.() || null;
    if (!targetMember) {
        await message.reply(`❌ Usage: ${this.prefix}mod @user`);
        return;
    }

    await this.assignRole(targetMember, 'Mod');
    await message.reply(`✅ Granted **Mod** to ${targetMember}.`);
},

async handleUnmod(message, args) {
    const isSuper = await this.isSuperUser(message.author?.id);
    const isTownCouncil = this.hasTownCouncilRole(message.member);
    let targetMember = message.mentions?.members?.first?.() || null;
    if (!targetMember && args[0] && args[0].toLowerCase() === 'me') {
        targetMember = message.member;
    }
    if (!targetMember) {
        await message.reply(`❌ Usage: \`${this.prefix}unmod @user\` or \`${this.prefix}unmod me\` (remove your own Mod role)`);
        return;
    }

    if (!isSuper && !isTownCouncil) {
        const canSelfDemod = this.hasModeratorPermissions(message.member) && targetMember.id === message.author.id;
        if (!canSelfDemod) {
            await message.reply('❌ Only super users and Town Council members can remove the Mod role from someone else. Moderators may use `Wolf.unmod me` to remove **their own** Mod role.');
            return;
        }
    }

    await this.removeRole(targetMember, 'Mod');
    await message.reply(`✅ Removed **Mod** from ${targetMember}.`);
},

isPublicChannel(message) {
    const channelName = message.channel.name.toLowerCase();
    return !channelName.includes('dead-chat') && !channelName.includes('mod-chat');
},

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
},

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
},

async assignSpectatorRole(member) {
    // Remove all game roles and assign spectator
    await this.removeRole(member, 'Signed Up');
    await this.removeRole(member, 'Alive');
    await this.removeRole(member, 'Dead');
    await this.assignRole(member, 'Spectator');
},

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
},

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
                COALESCE(NULLIF(TRIM(p.thematic_custom_name), ''), (
                  SELECT gr.custom_name FROM game_role gr
                  WHERE gr.game_id = p.game_id AND gr.role_id = p.role_id
                  ORDER BY gr.sort_index NULLS LAST
                  LIMIT 1
                )) as custom_name
         FROM players p
         LEFT JOIN roles r ON p.role_id = r.id
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
},

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
            ORDER BY gr.sort_index ASC, r.team, r.name
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
                count: 1,
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
        const totalCount = roleResult.rows.length;
        
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
},

};
