const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'populate_journals',
    playerCommand: false,
    async execute(bot, message, args) {
        if (process.env.NODE_ENV !== 'development') {
            return message.reply('❌ This command is only available in development mode.');
        }

        // Parse number of journals to create (default 50 if not specified)
        let numJournals = 50;
        if (args.length > 0) {
            const parsed = parseInt(args[0]);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
                numJournals = parsed;
            } else {
                return message.reply('❌ Please specify a number between 1 and 100. Usage: `Wolf.populate_journals [number]`');
            }
        }

        try {
            // Find or create the "Journals" category
            let journalsCategory = message.guild.channels.cache.find(
                channel => channel.type === ChannelType.GuildCategory && channel.name === 'Journals'
            );

            if (!journalsCategory) {
                // Create the Journals category
                journalsCategory = await message.guild.channels.create({
                    name: 'Journals',
                    type: ChannelType.GuildCategory,
                });
            }

            // Get roles for permissions
            const modRole = message.guild.roles.cache.find(r => r.name === 'Mod');
            const spectatorRole = message.guild.roles.cache.find(r => r.name === 'Spectator');
            const deadRole = message.guild.roles.cache.find(r => r.name === 'Dead');

            const createdChannels = [];
            const failedChannels = [];

            // Create test journals with random letter prefixes for better testing
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            for (let i = 1; i <= numJournals; i++) {
                try {
                    // Generate a random letter prefix
                    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                    const testName = `${randomLetter}TestUser${i.toString().padStart(3, '0')}`;
                    const journalChannelName = `${testName.toLowerCase()}-journal`;

                    // Check if journal already exists
                    const existingJournal = message.guild.channels.cache.find(
                        channel => channel.name === journalChannelName && channel.parent?.id === journalsCategory.id
                    );

                    if (existingJournal) {
                        failedChannels.push(`${testName} (already exists)`);
                        continue;
                    }

                    // Create the journal channel
                    const journalChannel = await message.guild.channels.create({
                        name: journalChannelName,
                        type: ChannelType.GuildText,
                        parent: journalsCategory.id,
                        permissionOverwrites: [
                            {
                                id: message.guild.roles.everyone.id,
                                deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                            },
                            ...(modRole ? [{
                                id: modRole.id,
                                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                                deny: [PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                            }] : []),
                            ...(spectatorRole ? [{
                                id: spectatorRole.id,
                                allow: [PermissionFlagsBits.ViewChannel],
                                deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                            }] : []),
                            ...(deadRole ? [{
                                id: deadRole.id,
                                allow: [PermissionFlagsBits.ViewChannel],
                                deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
                            }] : [])
                        ],
                    });

                    // Send initial message to the journal
                    const embed = new EmbedBuilder()
                        .setTitle(`📔 ${testName}'s Journal`)
                        .setDescription(`This is a test journal for ${testName}.\n\nThis journal was created for testing the journal balancing system.`)
                        .setColor(0x8B4513)
                        .setTimestamp();

                    await journalChannel.send({ embeds: [embed] });

                    createdChannels.push(testName);

                    // Add a small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    console.error(`Error creating test journal ${i}:`, error);
                    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                    failedChannels.push(`${randomLetter}TestUser${i.toString().padStart(3, '0')} (error: ${error.message})`);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('🧪 Test Journals Created')
                .setDescription(`Created ${createdChannels.length} test journals for testing the balance system.`)
                .addFields(
                    { name: 'Successfully Created', value: createdChannels.length.toString(), inline: true },
                    { name: 'Failed', value: failedChannels.length.toString(), inline: true },
                    { name: 'Total Requested', value: numJournals.toString(), inline: true }
                )
                .setColor(0x00AE86);

            if (failedChannels.length > 0) {
                embed.addFields({
                    name: 'Failed Journals',
                    value: failedChannels.slice(0, 10).join('\n') + (failedChannels.length > 10 ? `\n... and ${failedChannels.length - 10} more` : ''),
                    inline: false
                });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error populating journals:', error);
            await message.reply('❌ An error occurred while creating test journals.');
        }
    }
};
