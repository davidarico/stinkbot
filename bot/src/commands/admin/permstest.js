const { PermissionFlagsBits } = require('discord.js');

const PIN_PERMISSION = PermissionFlagsBits.ManageMessages;

module.exports = {
    name: 'perms_test',
    playerCommand: false,
    async execute(bot, message, args) {
        // Check if user mentioned someone
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply('❌ Please mention a user to create a journal for. Usage: `Wolf.journal @user`');
        }
        // Check if the mentioned user is in the server
        const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            return message.reply('❌ That user is not in this server.');
        }
        console.log("MEMBER:", JSON.stringify(targetMember));

        const channel = message.mentions.channels.first();
        if (!channel) {
            return message.reply('❌ Please mention a channel');
        }
        else if (channel.guild != message.guild) {
            return message.reply('❌ That channel is not in this server');
        }

        await channel.permissionOverwrites.edit(targetMember.id, {
            [PIN_PERMISSION]: true
        });

        return message.reply(`Granted ${targetMember} PinPermissions`);
    }
};
