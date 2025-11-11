module.exports = {
    name: 'sync_members',
    playerCommand: false,
    async execute(bot, message, args) {
        try {
            await message.reply('🔄 Starting manual server member sync... This may take a few moments.');

            // Call the sync method
            await bot.syncServerMembers();

            await message.reply('✅ Manual server member sync completed!');

        } catch (error) {
            console.error('Error handling manual sync members command:', error);
            await message.reply('❌ An error occurred while processing the sync command.');
        }
    }
};
