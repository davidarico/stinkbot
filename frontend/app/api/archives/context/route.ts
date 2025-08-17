import { NextRequest, NextResponse } from 'next/server'
import { openSearchClient } from '@/lib/opensearch'
import { db } from '@/lib/database'

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

    const response = await openSearchClient.search({
      index: 'messages',
      body: searchBody
    })

    // Get updated display names and profile pictures from database
    const hits = response.body.hits.hits
    const userIds = [...new Set(hits.map((hit: any) => hit._source.userId))]
    
    if (userIds.length > 0) {
      const serverUsers = await db.getServerUsersByUserIds(userIds)
      const userMap = new Map(serverUsers.map(user => [user.user_id, { displayName: user.display_name, profilePictureLink: user.profile_picture_link }]))
      
      // Update display names and profile pictures in results
      hits.forEach((hit: any) => {
        const userInfo = userMap.get(hit._source.userId)
        if (userInfo) {
          hit._source.displayName = userInfo.displayName
          hit._source.profilePictureLink = userInfo.profilePictureLink
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
