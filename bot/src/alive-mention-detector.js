const SQLiteManager = require('./sqlite-manager');
const cron = require('node-cron');

class AliveMentionDetector {
    constructor(client) {
        this.client = client;
        this.sqliteManager = new SQLiteManager();
        this.aliveRoleIds = new Map(); // serverId -> roleId
        this.modRoleIds = new Map(); // serverId -> roleId
        this.penaltyLevels = {
            2: { action: 'warn', duration: 0 },
            3: { action: 'timeout', duration: 300 }, // 5 minutes
            4: { action: 'timeout', duration: 1200 }, // 20 minutes
            5: { action: 'timeout', duration: 3600 }, // 1 hour
            6: { action: 'timeout', duration: 7200 }, // 2 hours
            7: { action: 'timeout', duration: 14400 }, // 4 hours
            8: { action: 'timeout', duration: 28800 }, // 8 hours
            9: { action: 'timeout', duration: 86400 } // 24 hours
        };

        this.setupCleanupTask();
    }

    setupCleanupTask() {
        // Run cleanup every 30 minutes
        cron.schedule('*/30 * * * *', async () => {
            try {
                await this.sqliteManager.cleanupOldRecords();
            } catch (error) {
                console.error('❌ Error in cleanup task:', error);
            }
        });
    }

    async initializeAliveRoles() {
        console.log('🔍 Initializing alive and mod roles for all servers...');
        
        for (const guild of this.client.guilds.cache.values()) {
            try {
                // Find Alive role
                const aliveRole = guild.roles.cache.find(role => role.name === 'Alive');
                if (aliveRole) {
                    this.aliveRoleIds.set(guild.id, aliveRole.id);
                    console.log(`✅ Found Alive role for ${guild.name}: ${aliveRole.id}`);
                } else {
                    console.log(`⚠️ No Alive role found for ${guild.name}`);
                }
                
                // Find Mod role
                const modRole = guild.roles.cache.find(role => role.name === 'Mod');
                if (modRole) {
                    this.modRoleIds.set(guild.id, modRole.id);
                    console.log(`✅ Found Mod role for ${guild.name}: ${modRole.id}`);
                } else {
                    console.log(`⚠️ No Mod role found for ${guild.name}`);
                }
            } catch (error) {
                console.error(`❌ Error finding roles for ${guild.name}:`, error);
            }
        }
    }

    async handleMessage(message) {
        if (message.author.bot) return;
        if (!message.guild) return; // DM messages

        const serverId = message.guild.id;
        const aliveRoleId = this.aliveRoleIds.get(serverId);
        
        if (!aliveRoleId) {
            // Try to find the role if not cached
            const aliveRole = message.guild.roles.cache.find(role => role.name === 'Alive');
            if (aliveRole) {
                this.aliveRoleIds.set(serverId, aliveRole.id);
            } else {
                return; // No alive role in this server
            }
        }

        // Check if user is a mod - if so, ignore their messages
        const modRoleId = this.modRoleIds.get(serverId);
        if (modRoleId && message.member && message.member.roles.cache.has(modRoleId)) {
            return; // Mods can mention alive as much as they want
        }

        // Check if message mentions the alive role
        if (this.messageMentionsAliveRole(message, aliveRoleId)) {
            await this.handleAliveMention(message, serverId);
        }
    }

    messageMentionsAliveRole(message, aliveRoleId) {
        // Check for role mentions
        if (message.mentions.roles.has(aliveRoleId)) {
            return true;
        }

        // Check for @everyone or @here mentions
        if (message.mentions.everyone || message.mentions.users.size > 0) {
            // Check if the message content contains the alive role mention
            const aliveRole = message.guild.roles.cache.get(aliveRoleId);
            if (aliveRole && message.content.includes(`<@&${aliveRoleId}>`)) {
                return true;
            }
        }

        return false;
    }

    async handleAliveMention(message, serverId) {
        const userId = message.author.id;
        
        try {
            // Record the mention
            await this.sqliteManager.recordMention(userId, serverId);
            
            // Get mention count in last hour
            const mentionCount = await this.sqliteManager.getMentionsInLastHour(userId, serverId);
            
            console.log(`📢 User ${message.author.tag} mentioned alive role (count: ${mentionCount})`);
            
            // Check if penalty should be applied
            if (mentionCount >= 2) {
                await this.applyPenalty(message, mentionCount, serverId);
            }
            
        } catch (error) {
            console.error('❌ Error handling alive mention:', error);
        }
    }

    async applyPenalty(message, mentionCount, serverId) {
        const penalty = this.penaltyLevels[mentionCount];
        if (!penalty) return;

        const userId = message.author.id;
        const member = message.member;

        if (!member) {
            console.error(`❌ Could not find member for user ${userId}`);
            return;
        }

        try {
            switch (penalty.action) {
                case 'warn':
                    await this.sendWarning(message, mentionCount);
                    break;
                    
                case 'timeout':
                    await this.applyTimeout(member, penalty.duration, mentionCount, message);
                    break;
                    
                default:
                    console.log(`⚠️ Unknown penalty action: ${penalty.action}`);
            }
        } catch (error) {
            console.error('❌ Error applying penalty:', error);
        }
    }

    async sendWarning(message, mentionCount) {
        const warningEmbed = {
            color: 0xFFA500, // Orange
            title: '⚠️ Alive Role Mention Warning',
            description: `You have mentioned the alive role ${mentionCount} times in the last hour. Please be mindful of excessive pinging.`,
            footer: {
                text: 'Next violation will result in a 5-minute timeout.'
            },
            timestamp: new Date().toISOString()
        };

        try {
            await message.reply({ embeds: [warningEmbed] });
        } catch (error) {
            console.error('❌ Error sending warning:', error);
        }
    }

    async applyTimeout(member, durationSeconds, mentionCount, originalMessage) {
        const durationMinutes = Math.floor(durationSeconds / 60);
        const durationHours = Math.floor(durationSeconds / 3600);
        
        let durationText;
        if (durationHours > 0) {
            durationText = `${durationHours} hour${durationHours > 1 ? 's' : ''}`;
        } else {
            durationText = `${durationMinutes} minute${durationMinutes > 1 ? 's' : ''}`;
        }

        try {
            await member.timeout(durationSeconds * 1000, `Excessive alive role mentions (${mentionCount} times in 1 hour)`);
            
            const timeoutEmbed = {
                color: 0xFF0000, // Red
                title: '🔇 Timeout Applied',
                description: `You have been timed out for ${durationText} due to excessive alive role mentions (${mentionCount} times in the last hour).`,
                footer: {
                    text: `After this timeout, you cannot mention alive for another hour.`
                },
                timestamp: new Date().toISOString()
            };

            await originalMessage.reply({ embeds: [timeoutEmbed] });
            
            console.log(`🔇 Timed out user ${member.user.tag} for ${durationText} (${mentionCount} mentions)`);
            
        } catch (error) {
            console.error('❌ Error applying timeout:', error);
            
            // Try to send a message if timeout failed
            try {
                await originalMessage.reply({
                    embeds: [{
                        color: 0xFF0000,
                        title: '❌ Timeout Failed',
                        description: 'Oh no! The bot is not able to timeout you. Due to a moderator dropping the ball, you get away with it this time.',
                        timestamp: new Date().toISOString()
                    }]
                });
            } catch (replyError) {
                console.error('❌ Error sending timeout failure message:', replyError);
            }
        }
    }

    async getAliveRoleIds() {
        return this.aliveRoleIds;
    }

    async getModRoleIds() {
        return this.modRoleIds;
    }

    async close() {
        await this.sqliteManager.close();
    }
}

module.exports = AliveMentionDetector;
