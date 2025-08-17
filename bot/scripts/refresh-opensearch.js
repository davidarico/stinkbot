const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
require('dotenv').config();

async function refreshOpenSearch() {
    console.log('🔄 Refreshing OpenSearch instance...');

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
        
        // Local OpenSearch instance - no AWS authentication
        client = new Client(clientConfig);
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
        // Check cluster health first
        console.log('🏥 Checking cluster health...');
        const health = await client.cluster.health();
        console.log('Cluster health:', health.body);

        // Check if the index exists
        const indexExists = await client.indices.exists({
            index: 'messages'
        });

        if (indexExists.body) {
            console.log('🗑️ Deleting existing "messages" index...');
            
            // Delete the index
            await client.indices.delete({
                index: 'messages'
            });
            console.log('✅ Index "messages" deleted successfully');
        } else {
            console.log('📋 Index "messages" does not exist, proceeding to create...');
        }

        // Wait a moment for the deletion to complete
        console.log('⏳ Waiting for index deletion to complete...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('📋 Creating fresh "messages" index...');

        // Create the index with optimized mapping for Discord messages
        const indexMapping = {
            index: 'messages',
            body: {
                settings: {
                    number_of_shards: 1,
                    number_of_replicas: 1,
                    analysis: {
                        analyzer: {
                            message_analyzer: {
                                type: 'custom',
                                tokenizer: 'standard',
                                filter: ['lowercase', 'stop', 'snowball']
                            }
                        }
                    }
                },
                mappings: {
                    properties: {
                        // Core message fields
                        messageId: { type: 'keyword' },
                        content: { 
                            type: 'text',
                            analyzer: 'message_analyzer',
                            fields: {
                                keyword: { type: 'keyword' }
                            }
                        },
                        timestamp: { type: 'date' },
                        
                        // User information
                        userId: { type: 'keyword' },
                        username: { type: 'keyword' },
                        displayName: { type: 'text' },
                        
                        // Channel information
                        channelId: { type: 'keyword' },
                        channelName: { type: 'keyword' },
                        categoryId: { type: 'keyword' },
                        categoryName: { type: 'keyword' },
                        
                        // Message metadata
                        replyToMessageId: { type: 'keyword' },
                        attachments: {
                            type: 'nested',
                            properties: {
                                id: { type: 'keyword' },
                                name: { type: 'text' },
                                url: { type: 'keyword' },
                                size: { type: 'long' }
                            }
                        },
                        embeds: {
                            type: 'nested',
                            properties: {
                                title: { type: 'text' },
                                description: { type: 'text' },
                                url: { type: 'keyword' }
                            }
                        },
                        reactions: {
                            type: 'nested',
                            properties: {
                                emoji: { type: 'keyword' },
                                count: { type: 'integer' }
                            }
                        },
                        
                        // Archive metadata
                        archivedAt: { type: 'date' },
                        archivedBy: {
                            type: 'object',
                            properties: {
                                userId: { type: 'keyword' },
                                username: { type: 'keyword' },
                                displayName: { type: 'text' }
                            }
                        },
                        
                        // Search optimization fields
                        contentLength: { type: 'integer' },
                        hasAttachments: { type: 'boolean' },
                        hasEmbeds: { type: 'boolean' },
                        hasReactions: { type: 'boolean' },
                        isReply: { type: 'boolean' }
                    }
                }
            }
        };

        await client.indices.create(indexMapping);
        console.log('✅ Fresh index "messages" created successfully');

        // Wait for the index to be ready
        console.log('⏳ Waiting for index to be ready...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Verify the index was created
        const newIndexExists = await client.indices.exists({
            index: 'messages'
        });

        if (newIndexExists.body) {
            console.log('✅ Index verification successful');
            
            // Get index stats to confirm it's empty
            const stats = await client.indices.stats({
                index: 'messages'
            });
            
            const docCount = stats.body.indices.messages.total.docs.count;
            console.log(`📊 Index document count: ${docCount}`);
            
            if (docCount === 0) {
                console.log('🎉 OpenSearch refresh completed successfully! Index is clean and ready.');
            } else {
                console.log('⚠️ Index contains documents, but refresh completed.');
            }
        } else {
            console.error('❌ Failed to verify index creation');
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Error refreshing OpenSearch:', error);
        process.exit(1);
    }
}

// Run the refresh function
refreshOpenSearch().catch(console.error);
