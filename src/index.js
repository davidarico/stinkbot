const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const db = require('./database');
const WerewolfBot = require('./werewolf-bot');

// Configure dotenv based on NODE_ENV
if (process.env.NODE_ENV !== 'production') {
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

const werewolfBot = new WerewolfBot(client, db);

client.once('ready', () => {
    console.log(`🤖 ${client.user.tag} is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
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

client.login(process.env.DISCORD_TOKEN);
