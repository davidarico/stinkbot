const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const db = require('./database');
const WerewolfBot = require('./werewolf-bot');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
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

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);
