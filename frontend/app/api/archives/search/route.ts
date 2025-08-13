import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@opensearch-project/opensearch'
import { db } from '@/lib/database'

const client = new Client({
  node: 'http://localhost:9200'
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('query') || ''
    const game = searchParams.get('game') || ''
    const channel = searchParams.get('channel') || ''
    const user = searchParams.get('user') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const size = parseInt(searchParams.get('size') || '20')
    const from = (page - 1) * size

    // Build the search query
    const must: any[] = []
    
    if (query) {
      must.push({
        multi_match: {
          query,
          fields: ['content', 'username', 'displayName'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      })
    }

    if (game) {
      must.push({ term: { category: game } })
    }

    if (channel) {
      must.push({ term: { channelName: channel } })
    }

    if (user) {
      must.push({
        bool: {
          should: [
            { term: { username: user } },
            { term: { displayName: user } }
          ]
        }
      })
    }

    const searchBody = {
      query: {
        bool: {
          must
        }
      },
      sort: [
        { timestamp: { order: 'desc' } }
      ],
      from,
      size,
      aggs: {
        games: {
          terms: { field: 'category', size: 100 }
        },
        channels: {
          terms: { field: 'channelName', size: 100 }
        },
        users: {
          terms: { field: 'displayName.keyword', size: 100 }
        }
      }
    }

    const response = await client.search({
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
      hits: response.body.hits,
      aggregations: response.body.aggregations
    })
  } catch (error) {
    console.error('OpenSearch search error:', error)
    return NextResponse.json(
      { error: 'Failed to search messages' },
      { status: 500 }
    )
  }
}
