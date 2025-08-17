const { Client } = require('@opensearch-project/opensearch');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function migrateS3Archives() {
    console.log('🔄 Starting migration of S3 archive files to OpenSearch...');

    // Validate required environment variables
    const requiredEnvVars = ['OPENSEARCH_DOMAIN_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET_NAME'];

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

    // Create OpenSearch client
    const endpoint = process.env.OPENSEARCH_DOMAIN_ENDPOINT;
    let client;

    // Check if this is a local endpoint (no AWS authentication needed)
    if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.startsWith('http://')) {
        console.log('🏠 Detected local OpenSearch instance');
        
        // Check for basic authentication credentials
        const clientConfig = {
            node: endpoint
        };

        if (process.env.OS_BASIC_USER && process.env.OS_BASIC_PASS) {
            console.log('🔐 Using basic authentication');
            clientConfig.auth = {
                username: process.env.OS_BASIC_USER,
                password: process.env.OS_BASIC_PASS
            };
        } else {
            console.log('⚠️ No basic authentication credentials provided (OS_BASIC_USER/OS_BASIC_PASS)');
        }
        
        client = new Client(clientConfig);
    } else {
        console.log('☁️ Detected AWS OpenSearch instance');
        
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
        // List all JSON files in the archives folder of S3 bucket
        console.log(`📁 Scanning S3 bucket: ${process.env.AWS_S3_BUCKET_NAME}/archives/`);
        
        const listCommand = new ListObjectsV2Command({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Prefix: 'archives/',
            MaxKeys: 1000
        });

        const listResponse = await s3Client.send(listCommand);
        
        if (!listResponse.Contents || listResponse.Contents.length === 0) {
            console.log('📁 No archive files found in S3 bucket');
            return;
        }

        // Filter for JSON files
        const jsonFiles = listResponse.Contents.filter(obj => 
            obj.Key && obj.Key.endsWith('.json') && obj.Key.startsWith('archives/')
        );

        if (jsonFiles.length === 0) {
            console.log('📁 No JSON archive files found in S3 bucket');
            return;
        }

        console.log(`📁 Found ${jsonFiles.length} archive files to migrate`);

        let totalArchivesProcessed = 0;
        let totalMessagesIndexed = 0;
        let totalMessagesFailed = 0;

        for (const s3Object of jsonFiles) {
            try {
                const filename = s3Object.Key.split('/').pop();
                console.log(`\n📂 Processing: ${filename}`);
                
                // Download the file from S3
                const getCommand = new GetObjectCommand({
                    Bucket: process.env.AWS_S3_BUCKET_NAME,
                    Key: s3Object.Key
                });

                const getResponse = await s3Client.send(getCommand);
                const fileContent = await getResponse.Body.transformToString('utf8');
                const archiveData = JSON.parse(fileContent);

                if (!archiveData.channels || !Array.isArray(archiveData.channels)) {
                    console.log(`⚠️ Skipping ${filename} - invalid format`);
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
                        category: archiveData.category,
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
                console.error(`❌ Error processing ${s3Object.Key}:`, fileError.message);
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
    migrateS3Archives();
}

module.exports = { migrateS3Archives };
