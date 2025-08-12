import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@opensearch-project/opensearch'

const client = new Client({
  node: 'http://localhost:9200'
})

export async function GET(request: NextRequest) {
  try {
    const searchBody = {
      size: 0,
      aggs: {
        games: {
          terms: { 
            field: 'category',
            size: 100,
            order: { _count: 'desc' }
          }
        },
        channels: {
          terms: { 
            field: 'channelName',
            size: 100,
            order: { _count: 'desc' }
          }
        },
        users: {
          terms: { 
            field: 'displayName.keyword',
            size: 100,
            order: { _count: 'desc' }
          }
        }
      }
    }

    const response = await client.search({
      index: 'messages',
      body: searchBody
    })

    return NextResponse.json({
      aggregations: response.body.aggregations
    })
  } catch (error) {
    console.error('OpenSearch aggregations error:', error)
    return NextResponse.json(
      { error: 'Failed to get aggregations' },
      { status: 500 }
    )
  }
}
