const { ChannelType } = require('discord.js');

const PIN_PERMISSION = 0x0008000000000000;

module.exports = {
    name: 'journal_pin_perms',
    playerCommand: false,
    async execute(bot, message, args) {
        // Get all journal categories
        const journalCategories = message.guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory &&
            (channel.name === 'Journals' || channel.name.startsWith('Journals ('))
        );

        if (journalCategories.size === 0) {
            return message.reply('❌ No journal categories found. Create some journals first with `Wolf.journal @user`.');
        }

        // Get all journal channels from all categories
        const allJournalChannels = [];
        for (const category of journalCategories.values()) {
            const categoryChannels = message.guild.channels.cache.filter(
                channel => channel.parent?.id === category.id && channel.name.endsWith('-journal')
            );
            allJournalChannels.push(...categoryChannels.values());
        }

        if (allJournalChannels.length === 0) {
            return message.reply('❌ No journal channels found in any journal categories.');
        }

        const failed = [];
        const serverId = message.guild.id;
        for (const journal of allJournalChannels) {
            // I'm sure this could be done with a single query for all player journal results but this command will only run once so performance doesn't seem that important
            const playerResult = await bot.db.query(
                'SELECT user_id FROM player_journals WHERE server_id = $1 AND channel_id = $2',
                [serverId, journal.id]
            );
            if (playerResult.rows.length === 0) {
                failed.push(`\t${journal.name} has no user_id`);
            }
            else {
                const user_id = playerResult.rows[0].user_id;
                const member = await message.guild.members.fetch(user_id).catch(() => null);
                if (!member) {
                    failed.push(`\t${journal.name} user ${user_id} not in server`);
                } else {
                    await journal.permissionOverwrites.edit(member.id, {
                        [PIN_PERMISSION]: true
                    });
                }
            }
        }

        if (failed.length > 0) {
            return message.reply(`❌ Failed for ${failed.length} Journals:\n${failed.join('\n')}`);
        } else {
            return message.reply('Success!');
        }
    }
};
