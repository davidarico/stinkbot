const { Client, GatewayIntentBits } = require('discord.js');
const db = require('../src/database');
require('dotenv').config();

// Print out environment variables for debugging
console.log('🔧 Environment Variables:')
console.log(`   DISCORD_TOKEN: ${process.env.DISCORD_TOKEN}`);
console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '[REDACTED]' : 'NOT SET'}`);

console.log('🧪 Starting Werewolf Bot Test Suite...\n');

// Test database connection
async function testDatabase() {
    console.log('🔍 Testing database connection...');
    try {
        const result = await db.query('SELECT NOW()');
        console.log('✅ Database connected successfully');
        console.log(`   Current time: ${result.rows[0].now}\n`);
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

// Test bot connection
async function testBot() {
    console.log('🔍 Testing bot connection...');
    
    if (!process.env.DISCORD_TOKEN) {
        console.error('❌ DISCORD_TOKEN not found in environment variables');
        return false;
    }

    try {
        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers
            ]
        });

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.error('❌ Bot connection timeout');
                client.destroy();
                resolve(false);
            }, 10000);

            client.once('ready', () => {
                clearTimeout(timeout);
                console.log('✅ Bot connected successfully');
                console.log(`   Bot tag: ${client.user.tag}`);
                console.log(`   Serving ${client.guilds.cache.size} servers\n`);
                client.destroy();
                resolve(true);
            });

            client.on('error', (error) => {
                clearTimeout(timeout);
                console.error('❌ Bot connection error:', error.message);
                client.destroy();
                resolve(false);
            });

            client.login(process.env.DISCORD_TOKEN);
        });
    } catch (error) {
        console.error('❌ Bot setup error:', error.message);
        return false;
    }
}

// Test database schema
async function testSchema() {
    console.log('🔍 Testing database schema...');
    try {
        // Test each table
        const tables = ['server_configs', 'games', 'players', 'votes'];
        
        for (const table of tables) {
            const result = await db.query(`SELECT COUNT(*) FROM ${table}`);
            console.log(`✅ Table '${table}' exists and accessible`);
        }
        
        console.log('✅ Database schema validation complete\n');
        return true;
    } catch (error) {
        console.error('❌ Database schema error:', error.message);
        console.log('💡 Make sure you have run the database_setup.sql file\n');
        return false;
    }
}

// Run all tests
async function runTests() {
    console.log('🚀 Running comprehensive test suite...\n');
    
    const dbTest = await testDatabase();
    if (!dbTest) return;
    
    const schemaTest = await testSchema();
    if (!schemaTest) return;
    
    const botTest = await testBot();
    
    console.log('📊 Test Results Summary:');
    console.log(`   Database: ${dbTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Schema: ${schemaTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Bot: ${botTest ? '✅ PASS' : '❌ FAIL'}`);
    
    if (dbTest && schemaTest && botTest) {
        console.log('\n🎉 All tests passed! Your bot is ready to use.');
        console.log('\n📝 Quick Setup Checklist:');
        console.log('   1. Copy .env.example to .env');
        console.log('   2. Fill in your Discord bot token and database credentials');
        console.log('   3. Run the database_setup.sql file in PostgreSQL');
        console.log('   4. Run "npm start" to start the bot');
        console.log('\n🎮 Bot Commands:');
        console.log('   Wolf.setup - Configure server settings');
        console.log('   Wolf.create - Create a new game');
        console.log('   Wolf.help - Show all commands');
    } else {
        console.log('\n❌ Some tests failed. Please check your configuration.');
    }
    
    process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Test suite interrupted');
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
    process.exit(1);
});

runTests();
