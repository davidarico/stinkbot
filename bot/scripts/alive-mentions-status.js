const SQLiteManager = require('../src/sqlite-manager');
const { Client, GatewayIntentBits } = require('discord.js');

async function showAliveMentionsStatus() {
    console.log('📊 Alive Mentions Status Report');
    console.log('================================\n');
    
    const sqliteManager = new SQLiteManager();
    
    // Initialize Discord client for role detection
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers
        ]
    });
    
    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
        // Get recent mentions (last 24 hours)
        const recentMentions = await sqliteManager.getRecentMentions(24);
        
        if (recentMentions.length === 0) {
            console.log('✅ No recent alive role mentions found in the last 24 hours');
        } else {
            console.log(`📈 Found ${recentMentions.length} mentions in the last 24 hours:\n`);
            
            // Group by user
            const userMentions = {};
            recentMentions.forEach(mention => {
                if (!userMentions[mention.user_id]) {
                    userMentions[mention.user_id] = [];
                }
                userMentions[mention.user_id].push(mention);
            });
            
            // Display by user
            for (const [userId, mentions] of Object.entries(userMentions)) {
                console.log(`👤 User ${userId}:`);
                console.log(`   📍 Server: ${mentions[0].server_id}`);
                console.log(`   🔢 Total mentions: ${mentions.length}`);
                console.log(`   ⏰ Last mention: ${mentions[mentions.length - 1].mentioned_at}`);
                
                // Check if they would be penalized
                const lastHourCount = mentions.filter(m => {
                    const mentionTime = new Date(m.mentioned_at);
                    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                    return mentionTime > oneHourAgo;
                }).length;
                
                if (lastHourCount >= 2) {
                    console.log(`   ⚠️  Would be penalized: ${lastHourCount} mentions in last hour`);
                } else {
                    console.log(`   ✅ No penalties: ${lastHourCount} mentions in last hour`);
                }
                console.log('');
            }
        }
        
        // Show database stats
        const stats = await sqliteManager.getDatabaseStats();
        console.log('📊 Database Statistics:');
        console.log(`   📁 Total records: ${stats.totalRecords}`);
        console.log(`   🧹 Records older than 1 hour: ${stats.oldRecords}`);
        console.log(`   💾 Database size: ${stats.dbSize} bytes`);
        
        // Show role detection info
        console.log('\n🛡️ Role Detection Status:');
        console.log('========================');
        
        if (process.env.DISCORD_TOKEN) {
            try {
                await client.login(process.env.DISCORD_TOKEN);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for login
                
                const AliveMentionDetector = require('../src/alive-mention-detector');
                const detector = new AliveMentionDetector(client);
                await detector.initializeAliveRoles();
                
                const aliveRoles = await detector.getAliveRoleIds();
                const modRoles = await detector.getModRoleIds();
                
                console.log(`   🏠 Servers with Alive roles: ${aliveRoles.size}`);
                console.log(`   🛡️ Servers with Mod roles: ${modRoles.size}`);
                
                for (const [serverId, aliveRoleId] of aliveRoles) {
                    const guild = client.guilds.cache.get(serverId);
                    const modRoleId = modRoles.get(serverId);
                    console.log(`   📍 ${guild?.name || 'Unknown'}: Alive=${aliveRoleId}, Mod=${modRoleId || 'None'}`);
                }
                
                await detector.close();
                await client.destroy();
            } catch (error) {
                console.log(`   ⚠️ Could not connect to Discord: ${error.message}`);
            }
        } else {
            console.log('   ⚠️ DISCORD_TOKEN not set - cannot show role detection status');
        }
        
    } catch (error) {
        console.error('❌ Error getting status:', error);
    } finally {
        await sqliteManager.close();
    }
}

// Add the missing methods to SQLiteManager
SQLiteManager.prototype.getRecentMentions = function(hours) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT user_id, server_id, mentioned_at 
            FROM alive_mentions 
            WHERE mentioned_at > datetime('now', '-${hours} hours')
            ORDER BY mentioned_at DESC
        `;
        
        this.db.all(sql, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
};

SQLiteManager.prototype.getDatabaseStats = function() {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT 
                COUNT(*) as totalRecords,
                SUM(CASE WHEN mentioned_at < datetime('now', '-1 hour') THEN 1 ELSE 0 END) as oldRecords
            FROM alive_mentions
        `;
        
        this.db.get(sql, (err, row) => {
            if (err) {
                reject(err);
            } else {
                // Get database file size
                const fs = require('fs');
                const path = require('path');
                const dbPath = path.join(__dirname, '../data/alive_mentions.db');
                
                let dbSize = 0;
                try {
                    const stats = fs.statSync(dbPath);
                    dbSize = stats.size;
                } catch (e) {
                    // Database file might not exist yet
                }
                
                resolve({
                    totalRecords: row ? row.totalRecords : 0,
                    oldRecords: row ? row.oldRecords : 0,
                    dbSize: dbSize
                });
            }
        });
    });
};

showAliveMentionsStatus().catch(console.error);
