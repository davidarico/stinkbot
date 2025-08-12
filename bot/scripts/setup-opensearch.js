const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
require('dotenv').config();

async function setupOpenSearch() {
    console.log('🔧 Setting up OpenSearch domain...');

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
        // Check if the index already exists
        const indexExists = await client.indices.exists({
            index: 'messages'
        });

        if (indexExists.body) {
            console.log('📋 Index "messages" already exists');
        } else {
            console.log('📋 Creating "messages" index...');

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
            console.log('✅ Index "messages" created successfully');
        }

        // Test the connection
        const health = await client.cluster.health();
        console.log('🏥 Cluster health:', health.body);

        // Create a test document to verify everything works
        const testDoc = {
            messageId: 'test-message-123',
            content: 'This is a test message for OpenSearch setup',
            timestamp: new Date().toISOString(),
            userId: 'test-user-123',
            username: 'testuser',
            displayName: 'Test User',
            channelId: 'test-channel-123',
            channelName: 'test-channel',
            categoryId: 'test-category-123',
            categoryName: 'test-category',
            archivedAt: new Date().toISOString(),
            archivedBy: {
                userId: 'test-archiver-123',
                username: 'testarchiver',
                displayName: 'Test Archiver'
            },
            contentLength: 45,
            hasAttachments: false,
            hasEmbeds: false,
            hasReactions: false,
            isReply: false
        };

        await client.index({
            index: 'messages',
            body: testDoc
        });

        console.log('✅ Test document indexed successfully');

        // Perform a test search
        const searchResult = await client.search({
            index: 'messages',
            body: {
                query: {
                    match: {
                        content: 'test message'
                    }
                }
            }
        });

        console.log('🔍 Test search completed successfully');
        console.log(`📊 Found ${searchResult.body.hits.total.value} documents`);

        console.log('🎉 OpenSearch setup completed successfully!');
        console.log('📝 You can now use the archive command to save messages to OpenSearch');

    } catch (error) {
        console.error('❌ Error setting up OpenSearch:', error);
        if (error.meta && error.meta.body) {
            console.error('Error details:', JSON.stringify(error.meta.body, null, 2));
        }
        process.exit(1);
    }
}

// Run the setup if this script is executed directly
if (require.main === module) {
    setupOpenSearch();
}

module.exports = { setupOpenSearch };
