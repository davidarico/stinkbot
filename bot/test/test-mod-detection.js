const { Client, GatewayIntentBits } = require('discord.js');
const AliveMentionDetector = require('../src/alive-mention-detector');

// Configure dotenv for testing
require('dotenv').config();

async function testModDetection() {
    console.log('🧪 Testing Mod Role Detection');
    
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
            // Initialize roles
            await detector.initializeAliveRoles();
            
            const aliveRoles = await detector.getAliveRoleIds();
            const modRoles = await detector.getModRoleIds();
            
            console.log('\n📊 Role Detection Results:');
            console.log('========================');
            
            for (const [serverId, aliveRoleId] of aliveRoles) {
                const guild = client.guilds.cache.get(serverId);
                const modRoleId = modRoles.get(serverId);
                
                console.log(`\n🏠 Server: ${guild?.name || 'Unknown'} (${serverId})`);
                console.log(`   ✅ Alive Role: ${aliveRoleId}`);
                console.log(`   ${modRoleId ? '✅' : '⚠️'} Mod Role: ${modRoleId || 'Not found'}`);
                
                if (modRoleId) {
                    const modRole = guild?.roles.cache.get(modRoleId);
                    console.log(`   📝 Mod Role Name: ${modRole?.name || 'Unknown'}`);
                    console.log(`   🛡️  Mods are exempt from alive mention penalties`);
                } else {
                    console.log(`   ⚠️  No mod role found - all users subject to penalties`);
                }
            }
            
            console.log('\n🔧 Updated Penalty System:');
            console.log('========================');
            console.log('2 mentions: Warning');
            console.log('3 mentions: 5 minutes timeout');
            console.log('4 mentions: 20 minutes timeout');
            console.log('5 mentions: 1 hour timeout');
            console.log('6+ mentions: Increasing timeouts');
            console.log('\n🛡️  Mods are completely exempt from all penalties');
            
        } catch (error) {
            console.error('❌ Error during initialization:', error);
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

testModDetection().catch(console.error);
