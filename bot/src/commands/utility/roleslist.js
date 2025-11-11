const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'roleslist',
    playerCommand: true,
    async execute(bot, message, args) {
        if (bot.isPublicChannel(message)) {
            return message.reply('WOAH! You trying to scuff the game? Wrong channel buddy!');
        }

        const serverId = message.guild.id;

        // Get active game
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status IN ($2, $3) ORDER BY id DESC LIMIT 1',
            [serverId, 'signup', 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        const playersResult = await bot.db.query(
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
        const gameThemeResult = await bot.db.query(
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

        const rolesList = roleSections.join('\n\n');

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

        const embed = new EmbedBuilder()
            .setTitle('🎭 Player Roles')
            .setDescription(`Here are all the assigned roles for ${game.game_name ? `${game.game_name} ` : ''}Game ${game.game_number}:`)
            .addFields(
                { name: 'Role Assignments', value: rolesList, inline: false },
                { name: 'Role Summary', value: roleSummary || 'No roles assigned', inline: false },
                { name: 'Legend', value: '🐺 = In Wolf Chat', inline: false }
            )
            .setColor(0x9B59B6)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
};
