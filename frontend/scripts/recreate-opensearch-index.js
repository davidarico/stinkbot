const { Client } = require('@opensearch-project/opensearch');

async function recreateOpenSearchIndex() {
    console.log('🔧 Recreating OpenSearch index with correct mappings...');

    // Create OpenSearch client for localhost
    const client = new Client({
        node: 'http://localhost:9200'
    });

    try {
        // Check if the index exists and delete it
        const indexExists = await client.indices.exists({
            index: 'messages'
        });

        if (indexExists.body) {
            console.log('🗑️ Deleting existing "messages" index...');
            await client.indices.delete({
                index: 'messages'
            });
            console.log('✅ Index deleted successfully');
        }

        console.log('📋 Creating "messages" index with correct mappings...');

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
                                displayName: { 
                                    type: 'text',
                                    fields: {
                                        keyword: { type: 'keyword' }
                                    }
                                }
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
        console.log('✅ Index "messages" created successfully with correct mappings');

        // Test the connection
        const health = await client.cluster.health();
        console.log('🏥 Cluster health:', health.body);

        console.log('🎉 OpenSearch index recreation completed successfully!');
        console.log('⚠️ Note: You will need to re-index your messages data');

    } catch (error) {
        console.error('❌ Error recreating OpenSearch index:', error);
        if (error.meta && error.meta.body) {
            console.error('Error details:', JSON.stringify(error.meta.body, null, 2));
        }
        process.exit(1);
    }
}

// Run the setup if this script is executed directly
if (require.main === module) {
    recreateOpenSearchIndex();
}

module.exports = { recreateOpenSearchIndex };

