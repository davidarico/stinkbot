const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'role_config',
    playerCommand: false,
    async execute(bot, message, args) {
        if (bot.isPublicChannel(message)) {
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

            const gameResult = await bot.db.query(gameQuery, [message.guild.id]);

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

            const roleResult = await bot.db.query(roleQuery, [game.id]);

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
};
