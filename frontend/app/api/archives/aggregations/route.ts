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

    // Get usernames for fallback by fetching sample messages for each user ID
    const usernameMap: { [key: string]: string } = {}
    
    for (const userId of userIds) {
      if (!userDisplayNames[userId]) {
        // Get a sample message for this user to extract their username
        const sampleQuery = {
          size: 1,
          query: {
            term: { userId: userId }
          }
        }
        
        try {
          const sampleResponse = await openSearchClient.search({
            index: 'messages',
            body: sampleQuery
          })
          
          if (sampleResponse.body.hits.hits.length > 0) {
            const username = sampleResponse.body.hits.hits[0]._source.username
            usernameMap[userId] = username
          }
        } catch (error) {
          console.error(`Error fetching sample message for user ${userId}:`, error)
        }
      }
    }

    // Replace user IDs with display names in the aggregations, fallback to username
    const updatedAggregations = {
      ...response.body.aggregations,
      users: {
        ...response.body.aggregations.users,
        buckets: response.body.aggregations.users.buckets
          .map((bucket: any) => {
            const displayName = userDisplayNames[bucket.key]
            if (displayName) {
              return { ...bucket, key: displayName }
            } else {
              // Fallback to username from archived messages
              const username = usernameMap[bucket.key]
              return { ...bucket, key: username || `User ${bucket.key}` }
            }
          })
          .sort((a: any, b: any) => {
            // Sort alphabetically by display name
            return a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' })
          })
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
