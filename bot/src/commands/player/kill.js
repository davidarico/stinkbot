module.exports = {
    name: 'kill',
    playerCommand: false,
    async execute(bot, message, args) {
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

        if (await bot.removeRole(targetMember, 'Alive')) {
            await bot.assignRole(targetMember, 'Dead');
        } else {
            return message.reply(`🪦 That user is not Alive in this game!`);
        }
    }
};
