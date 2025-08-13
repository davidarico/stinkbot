const { Client, GatewayIntentBits } = require('discord.js');
const AliveMentionDetector = require('../src/alive-mention-detector');

// Configure dotenv for testing
require('dotenv').config();

async function testAliveMentionDetection() {
    console.log('🧪 Testing Alive Mention Detection System');
    
    if (!process.env.DISCORD_TOKEN) {
        console.error('❌ DISCORD_TOKEN is required for testing');
        process.exit(1);
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers
        ]
    });

    const detector = new AliveMentionDetector(client);

    client.once('ready', async () => {
        console.log(`🤖 Bot is ready: ${client.user.tag}`);
        
        try {
            // Initialize alive roles
            await detector.initializeAliveRoles();
            
            const aliveRoles = await detector.getAliveRoleIds();
            const modRoles = await detector.getModRoleIds();
            console.log(`📊 Found ${aliveRoles.size} servers with Alive roles:`);
            
            for (const [serverId, roleId] of aliveRoles) {
                const guild = client.guilds.cache.get(serverId);
                const modRoleId = modRoles.get(serverId);
                console.log(`  - ${guild?.name || 'Unknown'} (${serverId}):`);
                console.log(`    Alive: ${roleId}`);
                console.log(`    Mod: ${modRoleId || 'Not found'}`);
            }
            
            console.log('\n✅ Alive mention detection system is ready!');
            console.log('📝 The system will now monitor for excessive @Alive mentions');
            console.log('🔧 Penalty levels:');
            console.log('  2 mentions: Warning');
            console.log('  3 mentions: 5 minutes timeout');
            console.log('  4 mentions: 20 minutes timeout');
            console.log('  5 mentions: 1 hour timeout');
            console.log('  6+ mentions: Increasing timeouts');
            console.log('🛡️  Mods are exempt from all penalties');
            
        } catch (error) {
            console.error('❌ Error during initialization:', error);
        }
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        
        console.log(`📨 Message from ${message.author.tag}: ${message.content.substring(0, 50)}...`);
        
        try {
            await detector.handleMessage(message);
        } catch (error) {
            console.error('❌ Error handling message:', error);
        }
    });

    try {
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('❌ Failed to login:', error);
        process.exit(1);
    }

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down test...');
        await detector.close();
        await client.destroy();
        process.exit(0);
    });
}

// Run the test
testAliveMentionDetection().catch(console.error);
