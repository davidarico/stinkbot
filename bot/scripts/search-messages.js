const { Client } = require('@opensearch-project/opensearch');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
require('dotenv').config();

async function searchMessages(query, options = {}) {
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
        const {
            from = 0,
            size = 20,
            channelName,
            username,
            categoryName,
            startDate,
            endDate,
            hasAttachments,
            hasEmbeds,
            isReply
        } = options;

        // Build search query
        const searchQuery = {
            bool: {
                must: [
                    {
                        multi_match: {
                            query: query,
                            fields: ['content^2', 'displayName', 'username'],
                            type: 'best_fields',
                            fuzziness: 'AUTO'
                        }
                    }
                ],
                filter: []
            }
        };

        // Add filters
        if (channelName) {
            searchQuery.bool.filter.push({
                term: { channelName: channelName }
            });
        }

        if (username) {
            searchQuery.bool.filter.push({
                term: { username: username }
            });
        }

        if (categoryName) {
            searchQuery.bool.filter.push({
                term: { categoryName: categoryName }
            });
        }

        if (startDate || endDate) {
            const rangeFilter = { timestamp: {} };
            if (startDate) rangeFilter.timestamp.gte = startDate;
            if (endDate) rangeFilter.timestamp.lte = endDate;
            searchQuery.bool.filter.push({ range: rangeFilter });
        }

        if (hasAttachments !== undefined) {
            searchQuery.bool.filter.push({
                term: { hasAttachments: hasAttachments }
            });
        }

        if (hasEmbeds !== undefined) {
            searchQuery.bool.filter.push({
                term: { hasEmbeds: hasEmbeds }
            });
        }

        if (isReply !== undefined) {
            searchQuery.bool.filter.push({
                term: { isReply: isReply }
            });
        }

        const searchBody = {
            index: 'messages',
            body: {
                query: searchQuery,
                sort: [
                    { timestamp: { order: 'desc' } }
                ],
                from: from,
                size: size,
                highlight: {
                    fields: {
                        content: {
                            pre_tags: ['**'],
                            post_tags: ['**'],
                            fragment_size: 150,
                            number_of_fragments: 3
                        }
                    }
                }
            }
        };

        const response = await client.search(searchBody);
        
        return {
            total: response.body.hits.total.value,
            hits: response.body.hits.hits.map(hit => ({
                id: hit._id,
                score: hit._score,
                source: hit._source,
                highlights: hit.highlight
            }))
        };

    } catch (error) {
        console.error('Error searching messages:', error);
        throw error;
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node search-messages.js <query> [options]');
        console.log('');
        console.log('Options:');
        console.log('  --channel <name>     Filter by channel name');
        console.log('  --username <name>    Filter by username');
        console.log('  --category <name>    Filter by category name');
        console.log('  --start-date <date>  Filter by start date (ISO format)');
        console.log('  --end-date <date>    Filter by end date (ISO format)');
        console.log('  --has-attachments    Filter for messages with attachments');
        console.log('  --has-embeds         Filter for messages with embeds');
        console.log('  --is-reply           Filter for reply messages');
        console.log('  --size <number>      Number of results (default: 20)');
        console.log('  --from <number>      Starting offset (default: 0)');
        console.log('');
        console.log('Examples:');
        console.log('  node search-messages.js "werewolf game"');
        console.log('  node search-messages.js "vote" --channel general --size 10');
        console.log('  node search-messages.js "role" --username alice --start-date 2024-01-01');
        return;
    }

    const query = args[0];
    const options = {};

    // Parse options
    for (let i = 1; i < args.length; i += 2) {
        const option = args[i];
        const value = args[i + 1];

        switch (option) {
            case '--channel':
                options.channelName = value;
                break;
            case '--username':
                options.username = value;
                break;
            case '--category':
                options.categoryName = value;
                break;
            case '--start-date':
                options.startDate = value;
                break;
            case '--end-date':
                options.endDate = value;
                break;
            case '--has-attachments':
                options.hasAttachments = true;
                i--; // Don't skip next argument
                break;
            case '--has-embeds':
                options.hasEmbeds = true;
                i--; // Don't skip next argument
                break;
            case '--is-reply':
                options.isReply = true;
                i--; // Don't skip next argument
                break;
            case '--size':
                options.size = parseInt(value);
                break;
            case '--from':
                options.from = parseInt(value);
                break;
        }
    }

    try {
        console.log(`🔍 Searching for: "${query}"`);
        if (Object.keys(options).length > 0) {
            console.log('📋 Filters:', options);
        }
        console.log('');

        const results = await searchMessages(query, options);
        
        console.log(`📊 Found ${results.total} messages`);
        console.log('');

        results.hits.forEach((hit, index) => {
            const msg = hit.source;
            console.log(`${index + 1}. [${msg.timestamp}] @${msg.username} in #${msg.channelName}`);
            console.log(`   Score: ${hit.score.toFixed(2)}`);
            
            if (hit.highlights && hit.highlights.content) {
                console.log(`   Content: ${hit.highlights.content.join(' ... ')}`);
            } else {
                console.log(`   Content: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
            }
            
            if (msg.hasAttachments) console.log('   📎 Has attachments');
            if (msg.hasEmbeds) console.log('   📋 Has embeds');
            if (msg.isReply) console.log('   ↩️ Is reply');
            console.log('');
        });

    } catch (error) {
        console.error('❌ Search failed:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { searchMessages };
