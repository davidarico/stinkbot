const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');
const db = require('./database');
const WerewolfBot = require('./werewolf-bot');
const AliveMentionDetector = require('./alive-mention-detector');

// Configure dotenv based on NODE_ENV
if (process.env.NODE_ENV !== 'production') {
    console.log('🔧 Loading environment variables from .env file');
    require('dotenv').config();
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Log discord token
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in the environment variables.');
    process.exit(1);
} else {
    console.log(`🔑 Using Discord token: ${process.env.DISCORD_TOKEN}`);
}

const werewolfBot = new WerewolfBot(client, db);
const aliveMentionDetector = new AliveMentionDetector(client);

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    
    // Initialize alive role detection
    await aliveMentionDetector.initializeAliveRoles();
    
    // Set up daily member sync cron job (runs at 2 AM UTC every day)
    const memberSyncCron = cron.schedule('0 4 * * *', async () => {
        console.log('🕐 Daily member sync cron job triggered');
        try {
            await werewolfBot.syncServerMembers();
        } catch (error) {
            console.error('❌ Error in daily member sync cron job:', error);
        }
    }, {
        scheduled: true,
        timezone: 'UTC'
    });
    
    if (process.env.NODE_ENV === 'production') {
        console.log('⏰ Daily member sync cron job scheduled (runs at 4 AM UTC daily)');
    
        setTimeout(async () => {
            console.log('🔄 Running initial member sync after startup...');
            try {
                await werewolfBot.syncServerMembers();
            } catch (error) {
                console.error('❌ Error in initial member sync:', error);
            }
        }, 30000); // 30 second delay
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Handle alive role mentions first
    await aliveMentionDetector.handleMessage(message);
    
    const prefix = process.env.BOT_PREFIX || 'Wolf.';
    if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

    await werewolfBot.handleMessage(message);
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    
    await werewolfBot.handleReaction(reaction, user);
});

client.on('guildMemberAdd', async (member) => {
    try {
        // Find the Spectator role
        const spectatorRole = member.guild.roles.cache.find(role => role.name === 'Spectator');
        
        if (spectatorRole) {
            await member.roles.add(spectatorRole);
            console.log(`✅ Assigned Spectator role to ${member.user.tag} (${member.id})`);
        } else {
            console.log(`⚠️ Spectator role not found in guild ${member.guild.name} (${member.guild.id})`);
        }
    } catch (error) {
        console.error(`❌ Failed to assign Spectator role to ${member.user.tag}:`, error);
    }
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    await aliveMentionDetector.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down gracefully...');
    await aliveMentionDetector.close();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
