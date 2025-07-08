// Development utilities for testing and debugging

const db = require('../src/database');

class DevUtils {
    // Reset all data for a specific server (useful for testing)
    static async resetServer(serverId) {
        try {
            await db.query('DELETE FROM votes WHERE game_id IN (SELECT id FROM games WHERE server_id = $1)', [serverId]);
            await db.query('DELETE FROM players WHERE game_id IN (SELECT id FROM games WHERE server_id = $1)', [serverId]);
            await db.query('DELETE FROM games WHERE server_id = $1', [serverId]);
            await db.query('DELETE FROM server_configs WHERE server_id = $1', [serverId]);
            console.log(`✅ Reset all data for server ${serverId}`);
        } catch (error) {
            console.error('❌ Error resetting server:', error);
        }
    }

    // Get all active games across all servers
    static async getActiveGames() {
        try {
            const result = await db.query(`
                SELECT g.*, sc.game_prefix, sc.game_name as server_game_name
                FROM games g
                JOIN server_configs sc ON g.server_id = sc.server_id
                WHERE g.status IN ('signup', 'active')
                ORDER BY g.created_at DESC
            `);
            return result.rows;
        } catch (error) {
            console.error('❌ Error getting active games:', error);
            return [];
        }
    }

    // Get player count for a game
    static async getPlayerCount(gameId) {
        try {
            const result = await db.query('SELECT COUNT(*) as count FROM players WHERE game_id = $1', [gameId]);
            return parseInt(result.rows[0].count);
        } catch (error) {
            console.error('❌ Error getting player count:', error);
            return 0;
        }
    }

    // Create a test server configuration
    static async createTestConfig(serverId, prefix = 'test', startNumber = 1, gameName = 'Test Game') {
        try {
            await db.query(
                `INSERT INTO server_configs (server_id, game_prefix, game_counter, game_name) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (server_id) 
                 DO UPDATE SET game_prefix = $2, game_counter = $3, game_name = $4`,
                [serverId, prefix, startNumber, gameName]
            );
            console.log(`✅ Created test config for server ${serverId}`);
        } catch (error) {
            console.error('❌ Error creating test config:', error);
        }
    }

    // Database health check
    static async healthCheck() {
        const checks = [];

        // Check database connection
        try {
            await db.query('SELECT NOW()');
            checks.push({ test: 'Database Connection', status: '✅ PASS' });
        } catch (error) {
            checks.push({ test: 'Database Connection', status: '❌ FAIL', error: error.message });
        }

        // Check tables exist
        const tables = ['server_configs', 'games', 'players', 'votes'];
        for (const table of tables) {
            try {
                await db.query(`SELECT COUNT(*) FROM ${table}`);
                checks.push({ test: `Table: ${table}`, status: '✅ PASS' });
            } catch (error) {
                checks.push({ test: `Table: ${table}`, status: '❌ FAIL', error: error.message });
            }
        }

        return checks;
    }

    // Print current database stats
    static async printStats() {
        try {
            const servers = await db.query('SELECT COUNT(*) as count FROM server_configs');
            const games = await db.query('SELECT COUNT(*) as count FROM games');
            const activeGames = await db.query('SELECT COUNT(*) as count FROM games WHERE status IN ($1, $2)', ['signup', 'active']);
            const players = await db.query('SELECT COUNT(*) as count FROM players');
            const votes = await db.query('SELECT COUNT(*) as count FROM votes');

            console.log('\n📊 Database Statistics:');
            console.log(`   Configured Servers: ${servers.rows[0].count}`);
            console.log(`   Total Games: ${games.rows[0].count}`);
            console.log(`   Active Games: ${activeGames.rows[0].count}`);
            console.log(`   Total Players: ${players.rows[0].count}`);
            console.log(`   Total Votes: ${votes.rows[0].count}`);
        } catch (error) {
            console.error('❌ Error getting stats:', error);
        }
    }
}

module.exports = DevUtils;

// If called directly, run some basic checks
if (require.main === module) {
    (async () => {
        console.log('🔧 Development Utilities\n');
        
        const health = await DevUtils.healthCheck();
        console.log('🏥 Health Check Results:');
        health.forEach(check => {
            console.log(`   ${check.test}: ${check.status}`);
            if (check.error) console.log(`      Error: ${check.error}`);
        });

        await DevUtils.printStats();
        
        process.exit(0);
    })();
}
