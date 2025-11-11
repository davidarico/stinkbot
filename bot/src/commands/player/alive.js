const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'alive',
    aliases: ['players'],
    playerCommand: true,
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await bot.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );

        if (!gameResult.rows.length) {
            return message.reply('❌ No active game found.');
        }

        const game = gameResult.rows[0];

        // Get all players in the game
        const allPlayers = await bot.db.query(
            'SELECT user_id, username FROM players WHERE game_id = $1 ORDER BY username',
            [game.id]
        );

        if (allPlayers.rows.length === 0) {
            return message.reply('❌ No players found in the current game.');
        }

        // Check if this is being called as 'players' command (which includes dead players)
        const isAddDead = message.content.toLowerCase().includes('wolf.players');

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

        const embed = new EmbedBuilder()
            .setTitle(isAddDead ? '👥 All Players' : '💚 Alive Players')
            .setDescription(isAddDead ? 'Here are all players, alive or dead, in this game:' : `Here are all the players currently alive in the game:`)
            .addFields({
                name: `Players (${alivePlayers.length})`,
                value: playerList
            })
            .setColor(0x00FF00);

        await message.reply({ embeds: [embed] });
    }
};
