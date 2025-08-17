const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function checkArchiveFormat() {
    console.log('🔍 Archive Format Checker');
    console.log('========================\n');

    // Validate required environment variables
    const requiredEnvVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET_NAME'];

    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            console.error(`❌ Missing required environment variable: ${envVar}`);
            process.exit(1);
        }
    }

    // Create S3 client
    const s3Client = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    try {
        // Get the filename from command line arguments
        const filename = process.argv[2];
        
        if (!filename) {
            console.error('❌ Please provide a filename to check. Usage: node check-archive-format.js <filename>');
            console.error('Example: node check-archive-format.js Origins_Game_1_1373822861352898811.json');
            process.exit(1);
        }

        console.log(`📁 Checking format of: ${filename}\n`);

        // Download the file from S3
        const getCommand = new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: `archives/${filename}`
        });

        const getResponse = await s3Client.send(getCommand);
        const fileContent = await getResponse.Body.transformToString('utf8');
        const archiveData = JSON.parse(fileContent);

        console.log('📋 Archive Structure Analysis:');
        console.log('==============================');

        // Check for required fields
        const hasCategory = !!archiveData.category;
        const hasCategoryId = !!archiveData.categoryId;
        const hasArchivedAt = !!archiveData.archivedAt;
        const hasArchivedBy = !!archiveData.archivedBy;
        const hasChannels = !!archiveData.channels && Array.isArray(archiveData.channels);

        console.log(`✅ Category: ${hasCategory ? 'Present' : 'Missing'} ${hasCategory ? `(${archiveData.category})` : ''}`);
        console.log(`✅ Category ID: ${hasCategoryId ? 'Present' : 'Missing'} ${hasCategoryId ? `(${archiveData.categoryId})` : ''}`);
        console.log(`✅ Archived At: ${hasArchivedAt ? 'Present' : 'Missing'} ${hasArchivedAt ? `(${archiveData.archivedAt})` : ''}`);
        console.log(`✅ Archived By: ${hasArchivedBy ? 'Present' : 'Missing'} ${hasArchivedBy ? `(${archiveData.archivedBy.username})` : ''}`);
        console.log(`✅ Channels Array: ${hasChannels ? 'Present' : 'Missing'} ${hasChannels ? `(${archiveData.channels.length} channels)` : ''}`);

        // Check for summary fields (old format)
        const hasTotalChannels = !!archiveData.totalChannels;
        const hasTotalMessages = !!archiveData.totalMessages;
        const hasIndexedMessages = !!archiveData.indexedMessages;
        const hasFailedMessages = !!archiveData.failedMessages;

        console.log(`\n📊 Summary Fields (Old Format):`);
        console.log(`✅ Total Channels: ${hasTotalChannels ? 'Present' : 'Missing'} ${hasTotalChannels ? `(${archiveData.totalChannels})` : ''}`);
        console.log(`✅ Total Messages: ${hasTotalMessages ? 'Present' : 'Missing'} ${hasTotalMessages ? `(${archiveData.totalMessages})` : ''}`);
        console.log(`✅ Indexed Messages: ${hasIndexedMessages ? 'Present' : 'Missing'} ${hasIndexedMessages ? `(${archiveData.indexedMessages})` : ''}`);
        console.log(`✅ Failed Messages: ${hasFailedMessages ? 'Present' : 'Missing'} ${hasFailedMessages ? `(${archiveData.failedMessages})` : ''}`);

        // Determine format type
        console.log('\n🎯 Format Analysis:');
        console.log('==================');

        if (hasChannels && archiveData.channels.length > 0) {
            console.log('✅ This is a FULL ARCHIVE format (compatible with migration script)');
            
            // Check first channel structure
            const firstChannel = archiveData.channels[0];
            console.log(`   - Contains ${archiveData.channels.length} channels`);
            console.log(`   - First channel: ${firstChannel.channelName} with ${firstChannel.messageCount} messages`);
            
            if (firstChannel.messages && firstChannel.messages.length > 0) {
                const firstMessage = firstChannel.messages[0];
                console.log(`   - First message has required fields: ${!!firstMessage.messageId}, ${!!firstMessage.content}, ${!!firstMessage.timestamp}`);
            }
        } else if (hasTotalChannels && hasTotalMessages) {
            console.log('❌ This is a SUMMARY ARCHIVE format (NOT compatible with migration script)');
            console.log('   - Contains only metadata, no actual message data');
            console.log('   - Migration script expects full message data in channels array');
        } else {
            console.log('❓ Unknown format - missing both channels array and summary fields');
        }

        console.log('\n💡 Solution:');
        console.log('============');
        
        if (hasChannels && archiveData.channels.length > 0) {
            console.log('✅ This archive is in the correct format for migration!');
            console.log('   You can run the migration script without issues.');
        } else {
            console.log('❌ This archive is in the old summary format and needs to be recreated.');
            console.log('\nTo fix this:');
            console.log('1. Use the archive command to create a new full archive:');
            console.log(`   Wolf.archive "${archiveData.category}"`);
            console.log('2. This will create a new archive with all message data included');
            console.log('3. The migration script will then be able to process it correctly');
        }

        console.log('\n📝 Expected Format for Migration:');
        console.log('================================');
        console.log('{');
        console.log('  "category": "Category Name",');
        console.log('  "categoryId": "123456789",');
        console.log('  "archivedAt": "2024-01-01T00:00:00.000Z",');
        console.log('  "archivedBy": { "userId": "...", "username": "...", "displayName": "..." },');
        console.log('  "channels": [');
        console.log('    {');
        console.log('      "channelName": "channel-name",');
        console.log('      "messageCount": 100,');
        console.log('      "messages": [');
        console.log('        {');
        console.log('          "messageId": "...",');
        console.log('          "content": "...",');
        console.log('          "timestamp": "...",');
        console.log('          "userId": "...",');
        console.log('          "username": "...",');
        console.log('          "displayName": "...",');
        console.log('          "channelId": "...",');
        console.log('          "channelName": "...",');
        console.log('          "replyToMessageId": "...",');
        console.log('          "attachments": [...],');
        console.log('          "embeds": [...],');
        console.log('          "reactions": [...]');
        console.log('        }');
        console.log('      ]');
        console.log('    }');
        console.log('  ]');
        console.log('}');

    } catch (error) {
        console.error('❌ Error checking archive format:', error);
        process.exit(1);
    }
}

// Run the check function
checkArchiveFormat().catch(console.error);
