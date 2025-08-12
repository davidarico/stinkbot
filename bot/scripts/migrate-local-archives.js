const { Client } = require('@opensearch-project/opensearch');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function migrateLocalArchives() {
    console.log('🔄 Starting migration of local archive files to OpenSearch...');

    // Validate required environment variables
    const requiredEnvVars = ['OPENSEARCH_DOMAIN_ENDPOINT'];

    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            console.error(`❌ Missing required environment variable: ${envVar}`);
            process.exit(1);
        }
    }

    // Create OpenSearch client
    const endpoint = process.env.OPENSEARCH_DOMAIN_ENDPOINT;
    let client;

    // Check if this is a local endpoint (no AWS authentication needed)
    if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.startsWith('http://')) {
        console.log('🏠 Detected local OpenSearch instance');
        
        // Local OpenSearch instance - no AWS authentication
        client = new Client({
            node: endpoint,
            // Optional: Add basic auth if your local instance requires it
            // auth: {
            //     username: process.env.OPENSEARCH_USERNAME || 'admin',
            //     password: process.env.OPENSEARCH_PASSWORD || 'admin'
            // }
        });
    } else {
        console.log('☁️ Detected AWS OpenSearch instance');
        
        // AWS OpenSearch instance - validate AWS credentials
        const awsRequiredVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'];
        for (const envVar of awsRequiredVars) {
            if (!process.env[envVar]) {
                console.error(`❌ Missing required AWS environment variable: ${envVar}`);
                process.exit(1);
            }
        }

        // Create OpenSearch client with AWS credentials
        client = new Client({
            ...createAwsSigv4Signer({
                region: process.env.AWS_REGION,
                service: 'es',
                getCredentials: () => {
                    return Promise.resolve({
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                    });
                },
            }),
            node: endpoint,
        });
    }

    try {
        // Find all archive files in the current directory
        const archiveFiles = fs.readdirSync('.')
            .filter(file => file.startsWith('archive_') && file.endsWith('.json'))
            .map(file => path.resolve(file));

        if (archiveFiles.length === 0) {
            console.log('📁 No archive files found in current directory');
            return;
        }

        console.log(`📁 Found ${archiveFiles.length} archive files to migrate`);

        let totalArchivesProcessed = 0;
        let totalMessagesIndexed = 0;
        let totalMessagesFailed = 0;

        for (const filePath of archiveFiles) {
            try {
                console.log(`\n📂 Processing: ${path.basename(filePath)}`);
                
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const archiveData = JSON.parse(fileContent);

                if (!archiveData.channels || !Array.isArray(archiveData.channels)) {
                    console.log(`⚠️ Skipping ${path.basename(filePath)} - invalid format`);
                    continue;
                }

                let archiveMessagesIndexed = 0;
                let archiveMessagesFailed = 0;

                // Process each channel in the archive
                for (const channel of archiveData.channels) {
                    if (!channel.messages || !Array.isArray(channel.messages)) {
                        continue;
                    }

                    console.log(`  📝 Processing ${channel.messages.length} messages from #${channel.channelName}`);

                    // Transform messages to new format
                    const messagesToIndex = channel.messages.map(msg => ({
                        messageId: msg.messageId,
                        content: msg.content,
                        userId: msg.userId,
                        username: msg.username,
                        displayName: msg.displayName,
                        timestamp: msg.timestamp,
                        channelId: msg.channelId,
                        channelName: msg.channelName,
                        categoryId: archiveData.categoryId,
                        categoryName: archiveData.category,
                        replyToMessageId: msg.replyToMessageId,
                        attachments: msg.attachments || [],
                        embeds: msg.embeds || [],
                        reactions: msg.reactions || [],
                        archivedAt: archiveData.archivedAt,
                        archivedBy: archiveData.archivedBy,
                        contentLength: msg.content ? msg.content.length : 0,
                        hasAttachments: msg.attachments && msg.attachments.length > 0,
                        hasEmbeds: msg.embeds && msg.embeds.length > 0,
                        hasReactions: msg.reactions && msg.reactions.length > 0,
                        isReply: msg.replyToMessageId ? true : false
                    }));

                    // Index messages in batches
                    const batchSize = 100;
                    for (let i = 0; i < messagesToIndex.length; i += batchSize) {
                        const batch = messagesToIndex.slice(i, i + batchSize);
                        
                        try {
                            const bulkBody = [];
                            for (const msg of batch) {
                                bulkBody.push({ index: { _index: 'messages' } });
                                bulkBody.push(msg);
                            }

                            const response = await client.bulk({
                                body: bulkBody
                            });

                            // Check for errors in bulk response
                            if (response.body.errors) {
                                const errors = response.body.items.filter(item => item.index && item.index.error);
                                archiveMessagesFailed += errors.length;
                                archiveMessagesIndexed += batch.length - errors.length;
                                
                                if (errors.length > 0) {
                                    console.log(`    ⚠️ Failed to index ${errors.length} messages in batch`);
                                }
                            } else {
                                archiveMessagesIndexed += batch.length;
                            }

                            // Rate limiting
                            await new Promise(resolve => setTimeout(resolve, 50));

                        } catch (bulkError) {
                            console.error(`    ❌ Error indexing batch:`, bulkError.message);
                            archiveMessagesFailed += batch.length;
                        }
                    }
                }

                console.log(`  ✅ Archive processed: ${archiveMessagesIndexed} indexed, ${archiveMessagesFailed} failed`);
                
                totalArchivesProcessed++;
                totalMessagesIndexed += archiveMessagesIndexed;
                totalMessagesFailed += archiveMessagesFailed;

            } catch (fileError) {
                console.error(`❌ Error processing ${path.basename(filePath)}:`, fileError.message);
            }
        }

        console.log(`\n🎉 Migration complete!`);
        console.log(`📊 Summary:`);
        console.log(`  - Archives processed: ${totalArchivesProcessed}`);
        console.log(`  - Messages indexed: ${totalMessagesIndexed}`);
        console.log(`  - Messages failed: ${totalMessagesFailed}`);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    migrateLocalArchives();
}

module.exports = { migrateLocalArchives };
