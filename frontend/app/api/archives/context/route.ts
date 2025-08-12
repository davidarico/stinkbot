import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@opensearch-project/opensearch'
import { db } from '@/lib/database'

const client = new Client({
  node: 'http://localhost:9200'
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get('channelId')
    const timestamp = searchParams.get('timestamp')
    const limit = parseInt(searchParams.get('limit') || '10')

    if (!channelId || !timestamp) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    const targetTime = new Date(timestamp).getTime()
    const timeWindow = 5 * 60 * 1000 // 5 minutes before and after

    const searchBody = {
      query: {
        bool: {
          must: [
            { term: { channelId } },
            {
              range: {
                timestamp: {
                  gte: new Date(targetTime - timeWindow).toISOString(),
                  lte: new Date(targetTime + timeWindow).toISOString()
                }
              }
            }
          ]
        }
      },
      sort: [
        { timestamp: { order: 'asc' } }
      ],
      size: limit * 2 // Get more messages to ensure we have enough context
    }

    const response = await client.search({
      index: 'messages',
      body: searchBody
    })

    // Get updated display names from database
    const hits = response.body.hits.hits
    const userIds = [...new Set(hits.map((hit: any) => hit._source.userId))]
    
    if (userIds.length > 0) {
      const serverUsers = await db.getServerUsersByUserIds(userIds)
      const userMap = new Map(serverUsers.map(user => [user.user_id, user.display_name]))
      
      // Update display names in results
      hits.forEach((hit: any) => {
        const updatedDisplayName = userMap.get(hit._source.userId)
        if (updatedDisplayName) {
          hit._source.displayName = updatedDisplayName
        }
      })
    }

    return NextResponse.json({
      messages: hits
    })
  } catch (error) {
    console.error('OpenSearch context error:', error)
    return NextResponse.json(
      { error: 'Failed to get message context' },
      { status: 500 }
    )
  }
}
