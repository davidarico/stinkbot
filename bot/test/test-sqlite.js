const SQLiteManager = require('../src/sqlite-manager');

async function testSQLiteManager() {
    console.log('🧪 Testing SQLite Manager');
    
    const sqliteManager = new SQLiteManager();
    
    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
        // Test recording a mention
        console.log('📝 Testing mention recording...');
        await sqliteManager.recordMention('123456789', '987654321');
        console.log('✅ Mention recorded successfully');
        
        // Test getting mention count
        console.log('🔍 Testing mention count...');
        const count = await sqliteManager.getMentionsInLastHour('123456789', '987654321');
        console.log(`✅ Found ${count} mentions in last hour`);
        
        // Test getting last mention time
        console.log('⏰ Testing last mention time...');
        const lastTime = await sqliteManager.getLastMentionTime('123456789', '987654321');
        console.log(`✅ Last mention time: ${lastTime}`);
        
        // Test cleanup
        console.log('🧹 Testing cleanup...');
        await sqliteManager.cleanupOldRecords();
        console.log('✅ Cleanup completed');
        
        console.log('\n🎉 All SQLite tests passed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await sqliteManager.close();
        console.log('🔒 SQLite connection closed');
    }
}

testSQLiteManager().catch(console.error);
