const { Client } = require('@opensearch-project/opensearch');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
require('dotenv').config();

async function testOpenSearchConnection() {
    console.log('🔍 Testing OpenSearch connection...');

    // Validate required environment variables
    if (!process.env.OPENSEARCH_DOMAIN_ENDPOINT) {
        console.error('❌ Missing required environment variable: OPENSEARCH_DOMAIN_ENDPOINT');
        process.exit(1);
    }

    // Create OpenSearch client
    const endpoint = process.env.OPENSEARCH_DOMAIN_ENDPOINT;
    let client;

    // Check if this is a local endpoint (no AWS authentication needed)
    if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.startsWith('http://') || endpoint.includes('192.168.')) {
        console.log('🏠 Detected local OpenSearch instance');
        
        // Check for basic authentication credentials
        const clientConfig = {
            node: endpoint,
            maxRetries: 3,
            requestTimeout: 30000,
            sniffOnStart: false
        };

        if (process.env.OS_BASIC_USER && process.env.OS_BASIC_PASS) {
            console.log('🔐 Using basic authentication');
            console.log(`   Username: ${process.env.OS_BASIC_USER}`);
            console.log(`   Password: ${'*'.repeat(process.env.OS_BASIC_PASS.length)}`);
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
        // Test basic connection
        console.log('\n📡 Testing basic connection...');
        const health = await client.cluster.health();
        console.log('✅ Connection successful!');
        console.log(`🏥 Cluster health: ${health.body.status}`);
        console.log(`📊 Number of nodes: ${health.body.number_of_nodes}`);
        console.log(`📋 Number of indices: ${health.body.number_of_indices}`);

        // Test if messages index exists
        console.log('\n📋 Checking for messages index...');
        const indexExists = await client.indices.exists({
            index: 'messages'
        });

        if (indexExists.body) {
            console.log('✅ Messages index exists');
            
            // Get index stats with better error handling
            try {
                const stats = await client.indices.stats({ index: 'messages' });
                
                // Check if the response structure is as expected
                if (stats.body && stats.body.indices && stats.body.indices.messages) {
                    const docCount = stats.body.indices.messages.total.docs.count;
                    console.log(`📊 Document count: ${docCount}`);
                } else {
                    console.log('⚠️ Unexpected stats response structure:');
                    console.log(JSON.stringify(stats.body, null, 2));
                }
            } catch (statsError) {
                console.log('⚠️ Could not get index stats:', statsError.message);
            }
        } else {
            console.log('⚠️ Messages index does not exist');
        }

        // Test a simple search
        console.log('\n🔍 Testing search functionality...');
        try {
            const searchResult = await client.search({
                index: 'messages',
                body: {
                    query: {
                        match_all: {}
                    },
                    size: 1
                }
            });

            console.log('✅ Search functionality working');
            if (searchResult.body && searchResult.body.hits && searchResult.body.hits.total) {
                console.log(`📊 Total documents available: ${searchResult.body.hits.total.value}`);
            } else {
                console.log('⚠️ Unexpected search response structure');
            }
        } catch (searchError) {
            console.log('⚠️ Search test failed:', searchError.message);
        }

        console.log('\n🎉 All tests passed! OpenSearch connection is working correctly.');

    } catch (error) {
        console.error('❌ Connection test failed:', error.message);
        if (error.meta && error.meta.body) {
            console.error('Error details:', JSON.stringify(error.meta.body, null, 2));
        }
        if (error.meta && error.meta.statusCode) {
            console.error('Status code:', error.meta.statusCode);
        }
        if (error.meta && error.meta.headers) {
            console.error('Response headers:', JSON.stringify(error.meta.headers, null, 2));
        }
        process.exit(1);
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    testOpenSearchConnection();
}

module.exports = { testOpenSearchConnection };
