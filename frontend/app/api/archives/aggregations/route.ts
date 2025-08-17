import { NextRequest, NextResponse } from 'next/server'
import { openSearchClient } from '@/lib/opensearch'
import { db } from '@/lib/database'

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
            field: 'userId',
            size: 100,
            order: { _count: 'desc' }
          }
        }
      }
    }

    const response = await openSearchClient.search({
      index: 'messages',
      body: searchBody
    })

    // Get user IDs from aggregations
    const userIds = response.body.aggregations.users.buckets.map((bucket: any) => bucket.key)
    
    // Fetch current display names from server_users table
    let userDisplayNames: { [key: string]: string } = {}
    if (userIds.length > 0) {
      const serverUsers = await db.getServerUsersByUserIds(userIds)
      userDisplayNames = Object.fromEntries(
        serverUsers.map(user => [user.user_id, user.display_name])
      )
    }

    // Replace user IDs with display names in the aggregations
    const updatedAggregations = {
      ...response.body.aggregations,
      users: {
        ...response.body.aggregations.users,
        buckets: response.body.aggregations.users.buckets.map((bucket: any) => ({
          ...bucket,
          key: userDisplayNames[bucket.key] || bucket.key // Fallback to user ID if display name not found
        }))
      }
    }

    return NextResponse.json({
      aggregations: updatedAggregations
    })
  } catch (error) {
    console.error('OpenSearch aggregations error:', error)
    return NextResponse.json(
      { error: 'Failed to get aggregations' },
      { status: 500 }
    )
  }
}
