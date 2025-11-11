const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'feedback',
    playerCommand: true,
    async execute(bot, message, args) {
        try {
            // Check if feedback text was provided
            if (args.length === 0) {
                await message.reply('Please provide feedback text. Usage: `' + bot.prefix + 'feedback <your feedback message>`');
                return;
            }

            const feedbackText = args.join(' ').trim();

            // Validate feedback length
            if (feedbackText.length > 2000) {
                await message.reply('Feedback is too long. Please keep it under 2000 characters.');
                return;
            }

            if (feedbackText.length < 3) {
                await message.reply('Feedback is too short. Please provide more details.');
                return;
            }

            // Get user information
            const userId = message.author.id;
            const displayName = message.member?.displayName || message.author.username;
            const serverId = message.guild.id;

            // Insert feedback into database using parameterized query to prevent SQL injection
            const query = `
                INSERT INTO feedback (user_id, display_name, feedback_text, server_id)
                VALUES ($1, $2, $3, $4)
                RETURNING id, created_at
            `;

            const result = await bot.db.query(query, [userId, displayName, feedbackText, serverId]);

            if (result.rows.length > 0) {
                const feedbackId = result.rows[0].id;
                const createdAt = result.rows[0].created_at;

                // Send confirmation message
                const embed = new EmbedBuilder()
                    .setTitle('✅ Feedback Submitted')
                    .setDescription(`Thank you for your feedback, ${displayName}!`)
                    .setColor(0x00AE86)
                    .setFooter({ text: 'Your feedback has been recorded and will be reviewed by that lazy bum Stinky.' });

                await message.reply({ embeds: [embed] });

                console.log(`Feedback submitted by ${displayName} (${userId}) in server ${serverId}: ${feedbackText.substring(0, 100)}...`);
            } else {
                throw new Error('Failed to insert feedback into database');
            }

        } catch (error) {
            console.error('Error handling feedback command:', error);
            await message.reply('Sorry, there was an error submitting your feedback. Please try again later.');
        }
    }
};
