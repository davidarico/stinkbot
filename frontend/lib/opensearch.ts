import { Client } from '@opensearch-project/opensearch'

// Create OpenSearch client with optional basic authentication
const clientConfig: any = {
  node: process.env.OPENSEARCH_DOMAIN_ENDPOINT || 'http://localhost:9200'
}

if (process.env.OS_BASIC_USER && process.env.OS_BASIC_PASS) {
  clientConfig.auth = {
    username: process.env.OS_BASIC_USER,
    password: process.env.OS_BASIC_PASS
  }
}

export const openSearchClient = new Client(clientConfig)
