const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class SQLiteManager {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '../data/alive_mentions.db');
        this.init();
    }

    async init() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Initialize database
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ Error opening SQLite database:', err.message);
                } else {
                    console.log('✅ SQLite database connected');
                    this.createTables();
                }
            });
        } catch (error) {
            console.error('❌ Error initializing SQLite database:', error);
        }
    }

    createTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS alive_mentions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                server_id TEXT NOT NULL,
                mentioned_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createIndexSQL = `
            CREATE INDEX IF NOT EXISTS idx_alive_mentions_user_server_time 
            ON alive_mentions(user_id, server_id, mentioned_at)
        `;

        this.db.run(createTableSQL, (err) => {
            if (err) {
                console.error('❌ Error creating alive_mentions table:', err.message);
            } else {
                console.log('✅ alive_mentions table ready');
                
                // Create index
                this.db.run(createIndexSQL, (indexErr) => {
                    if (indexErr) {
                        console.error('❌ Error creating index:', indexErr.message);
                    } else {
                        console.log('✅ alive_mentions index ready');
                    }
                });
            }
        });
    }

    async recordMention(userId, serverId) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO alive_mentions (user_id, server_id) VALUES (?, ?)`;
            this.db.run(sql, [userId, serverId], function(err) {
                if (err) {
                    console.error('❌ Error recording mention:', err.message);
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    async getMentionsInLastHour(userId, serverId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT COUNT(*) as count 
                FROM alive_mentions 
                WHERE user_id = ? 
                AND server_id = ? 
                AND mentioned_at > datetime('now', '-1 hour')
            `;
            
            this.db.get(sql, [userId, serverId], (err, row) => {
                if (err) {
                    console.error('❌ Error getting mentions count:', err.message);
                    reject(err);
                } else {
                    resolve(row ? row.count : 0);
                }
            });
        });
    }

    async getLastMentionTime(userId, serverId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT mentioned_at 
                FROM alive_mentions 
                WHERE user_id = ? 
                AND server_id = ? 
                ORDER BY mentioned_at DESC 
                LIMIT 1
            `;
            
            this.db.get(sql, [userId, serverId], (err, row) => {
                if (err) {
                    console.error('❌ Error getting last mention time:', err.message);
                    reject(err);
                } else {
                    resolve(row ? row.mentioned_at : null);
                }
            });
        });
    }

    async cleanupOldRecords() {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM alive_mentions WHERE mentioned_at < datetime('now', '-1 hour')`;
            
            this.db.run(sql, (err) => {
                if (err) {
                    console.error('❌ Error cleaning up old records:', err.message);
                    reject(err);
                } else {
                    console.log('🧹 Cleaned up old alive mention records');
                    resolve();
                }
            });
        });
    }

    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('❌ Error closing SQLite database:', err.message);
                    } else {
                        console.log('✅ SQLite database closed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = SQLiteManager;
