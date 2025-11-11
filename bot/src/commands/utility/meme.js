module.exports = {
    name: 'meme',
    playerCommand: true,
    async execute(bot, message, args) {
        try {
            const username = message.author.username.toLowerCase();
            const displayName = message.member ? message.member.displayName.toLowerCase() : '';

            // Check if the user has "geese" in their username or display name
            if (username.includes('geese') || displayName.includes('geese')) {
                await message.reply('And especially you! You\'re not getting anything from me');
            } else {
                await message.reply('Are you kidding me? After all the vitriol you put me through, you expect me to just give you a little funny quip or joke? I\'ll give you something to laugh about if youre not careful');
            }
        } catch (error) {
            console.error('Error handling meme command:', error);
            await message.reply('❌ An error occurred while processing the meme command.');
        }
    }
};
