const { ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'end',
    playerCommand: false,  // admin only
    async execute(bot, message, args) {
        const serverId = message.guild.id;

        // Get active game
        const gameResult = await bot.db.query(
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
        await bot.db.query(
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
                        await bot.removeRole(member, 'Signed Up');
                        await bot.removeRole(member, 'Alive');
                        await bot.removeRole(member, 'Dead');

                        // Assign Spectator role
                        await bot.assignRole(member, 'Spectator');
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
};
