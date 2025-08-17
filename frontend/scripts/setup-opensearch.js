const { Client } = require('@opensearch-project/opensearch');
require('dotenv').config();

async function setupOpenSearch() {
    console.log('🔧 Setting up OpenSearch for frontend...');

    // Create OpenSearch client with optional basic authentication
    const clientConfig = {
        node: process.env.OPENSEARCH_DOMAIN_ENDPOINT || 'http://localhost:9200'
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

    const client = new Client(clientConfig);

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
                            displayName: { 
                                type: 'text',
                                fields: {
                                    keyword: { type: 'keyword' }
                                }
                            },
                            
                            // Channel information
                            channelId: { type: 'keyword' },
                            channelName: { type: 'keyword' },
                            category: { type: 'keyword' },
                            categoryId: { type: 'keyword' },
                            
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

        console.log('🎉 OpenSearch setup completed successfully!');

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
