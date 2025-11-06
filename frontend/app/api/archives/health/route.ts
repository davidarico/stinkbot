import { NextResponse } from 'next/server'
import { openSearchClient } from '@/lib/opensearch'

export async function GET() {
  try {
    console.log('Health check - Testing OpenSearch connection...')
    
    // Check if environment variables are set
    const config = {
      endpoint: process.env.OPENSEARCH_DOMAIN_ENDPOINT || 'not set',
      hasAuth: !!(process.env.OS_BASIC_USER && process.env.OS_BASIC_PASS),
      user: process.env.OS_BASIC_USER || 'not set'
    }
    
    console.log('Configuration:', config)
    
    // Try to ping OpenSearch
    const pingResponse = await openSearchClient.ping()
    
    // Try to get cluster info
    const infoResponse = await openSearchClient.info()
    
    // Check if messages index exists
    const indexExists = await openSearchClient.indices.exists({
      index: 'messages'
    })
    
    // Handle different response formats (body vs direct)
    const responseBody = infoResponse.body || infoResponse
    const indexExistsResult = indexExists.body !== undefined ? indexExists.body : indexExists
    
    return NextResponse.json({
      status: 'healthy',
      opensearch: {
        connected: true,
        version: responseBody?.version?.number || 'unknown',
        cluster_name: responseBody?.cluster_name || 'unknown',
        raw_response: responseBody // For debugging
      },
      index: {
        exists: indexExistsResult,
        name: 'messages'
      },
      config: {
        endpoint: config.endpoint,
        hasAuth: config.hasAuth,
        user: config.user !== 'not set' ? '***' : 'not set'
      }
    })
  } catch (error: any) {
    console.error('Health check failed:', error)
    return NextResponse.json(
      { 
        status: 'unhealthy',
        error: error.message,
        details: error.meta?.body || error.meta,
        config: {
          endpoint: process.env.OPENSEARCH_DOMAIN_ENDPOINT || 'not set',
          hasAuth: !!(process.env.OS_BASIC_USER && process.env.OS_BASIC_PASS),
          user: process.env.OS_BASIC_USER ? '***' : 'not set'
        }
      },
      { status: 500 }
    )
  }
}


