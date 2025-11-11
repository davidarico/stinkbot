const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'help',
    playerCommand: true,
    async execute(bot, message, args) {
        const isAdmin = bot.hasModeratorPermissions(message.member);

        const embed = new EmbedBuilder()
            .setTitle('🐺 Werewolf Bot Commands')
            .setDescription('Here are the available commands:')
            .setColor(0x3498DB);

        // Player commands (everyone can use) - grouped together
        embed.addFields(
            {
                name: '👥 Player Commands',
                value: '`Wolf.in` - Sign up for the current game\n' +
                       '`Wolf.out` - Remove yourself from the current game\n' +
                       '`Wolf.vote @user` - Vote for a player (voting booth, day phase only)\n' +
                       '`Wolf.retract` - Retract your current vote\n' +
                       '`Wolf.alive` - Show all players currently alive\n' +
                       '`Wolf.dead` - Show all players currently dead\n' +
                       '`Wolf.players` - Show all players dead or alive\n' +
                       '`Wolf.meme` - 😤 I dare you to try me\n' +
                       '`Wolf.help` - Show this help message\n' +
                       '`Wolf.feedback` - Submit feedback to Stinky',
                inline: false
            }
        );

        // Admin commands (only if user is admin) - grouped by category
        if (isAdmin) {
            embed.addFields(
                {
                    name: '⚙️ Setup & Game Management',
                    value: '`Wolf.setup` - Initial server setup (prefix, starting number, game name)\n' +
                           '`Wolf.server_roles` - 🎭 Create all game roles\n' +
                           '`Wolf.create` - Create a new game with signup channel\n' +
                           '`Wolf.start` - Start the game and create all channels\n' +
                           '`Wolf.settings` - View/change game and channel settings (votes_to_hang, messages)\n' +
                           '`Wolf.next` - Move to the next phase (day/night)\n' +
                           '`Wolf.end` - End the current game (requires confirmation)',
                    inline: false
                },
                {
                    name: '🔧 Channel & Phase Management',
                    value: '`Wolf.add_channel <n>` - Create additional channel in game category\n' +
                           '`Wolf.create_vote` - 🗳️ Manually create a voting message (voting booth only)\n' +
                           '`Wolf.lockdown` - 🔒 Lock down townsquare and memos (alive players cannot speak)\n' +
                           '`Wolf.lockdown lift` - 🔓 Lift lockdown and restore normal permissions\n' +
                           '`Wolf.sync_members` - 🔄 Sync server members to database',
                    inline: false
                },
                {
                    name: '📔 Journal Management',
                    value: '`Wolf.journal @user` - Create a personal journal for a player\n' +
                           '`Wolf.journal_link` - 🔗 Link existing journals to players\n' +
                           '`Wolf.journal_owner` - 👤 Show journal owner (use in journal)\n' +
                           '`Wolf.journal_unlink` - 🔓 Unlink journal (use in journal)\n' +
                           '`Wolf.journal_assign @user` - 🎯 Assign journal to user (use in journal)\n' +
                           '`Wolf.balance_journals` - 📚 Balance journals across categories (50 channel limit)\n' +
                           '`Wolf.populate_journals [number]` - 🧪 Create test journals for testing',
                    inline: false
                },
                {
                    name: '🎭 Role & Player Management',
                    value:  // fletch: v Hallucinated or deprecated command v
                            //'`Wolf.role_assign` - Randomly assign roles to signed-up players\n' +
                           '`Wolf.roles_list` - 📋 Display all assigned roles for current game' +
                           '`Wolf.role_config` - 🔧 Current saved role configuration\n' +
                           '`Wolf.kill @player` - 🔫 Removes Alive and adds Dead role\n',
                    inline: false
                },
                {
                    name: '📊 Analysis & Utilities',
                    value: '`Wolf.server` - 🖥️ Display detailed server information\n' +
                           '`Wolf.ia <YYYY-MM-DD HH:MM>` - Message count per player since date (EST)\n' +
                           '`Wolf.speed <number> [emoji]` - ⚡ Start speed vote with reaction target (optional custom emoji)',
                    inline: false
                },
                {
                    name: '🔄 Recovery & Maintenance',
                    value: '`Wolf.recovery` - Migration from manual to bot control\n' +
                           '`Wolf.todo` - 🐛 Display todo list\n' +
                           '`Wolf.refresh` - Reset server (testing only!)\n' +
                           '`Wolf.archive` - Archive current game data\n' +
                           '`Wolf.archive_local` - 💾 Archive to local JSON file (dev only)',
                    inline: false
                }
            );
        } else {
            embed.setFooter({ text: 'Note: Some commands are only available to moderators.' });
        }

        await message.reply({ embeds: [embed] });
    }
};
