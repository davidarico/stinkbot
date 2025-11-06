import { NextRequest, NextResponse } from 'next/server'
import { openSearchClient } from '@/lib/opensearch'
import { db } from '@/lib/database'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('query') || ''
    const game = searchParams.get('game') || ''
    const channel = searchParams.get('channel') || ''
    const user = searchParams.get('user') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const size = parseInt(searchParams.get('size') || '20')
    const jumpToMessageId = searchParams.get('jumpToMessageId') || ''
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
      // Find the user ID that corresponds to this display name
      const serverUsers = await db.getServerUsersByDisplayName(user)
      if (serverUsers.length > 0) {
        const userIds = serverUsers.map(u => u.user_id)
        must.push({ terms: { userId: userIds } })
      } else {
        // Fallback: try to match by display name directly
        must.push({ term: { 'displayName.keyword': user } })
      }
    }

    // Determine sort order based on whether we're jumping to a specific message
    const sortOrder = jumpToMessageId ? 'asc' : 'desc' // asc for chronological reading, desc for normal browsing
    
    const searchBody = {
      query: {
        bool: {
          must
        }
      },
      sort: [
        { timestamp: { order: sortOrder } }
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

    const response = await openSearchClient.search({
      index: 'messages',
      body: searchBody
    })

    // If jumping to a specific message, find the correct page
    let targetPage = page
    if (jumpToMessageId) {
        console.log('🎯 API: Calculating page for jumpToMessageId:', jumpToMessageId)
        try {
          // Get the target message by its Discord message ID
          const targetSearchResponse = await openSearchClient.search({
            index: 'messages',
            body: {
              query: {
                term: {
                  messageId: jumpToMessageId
                }
              },
              size: 1
            }
          })
          
          if (targetSearchResponse.body.hits.hits.length > 0) {
            const targetMessage = targetSearchResponse.body.hits.hits[0]
            const targetTimestamp = targetMessage._source.timestamp
          
            console.log('📅 API: Target message timestamp:', targetTimestamp)
            
            // Count messages before this timestamp in the same order as the main search
            // For asc order (chronological), count messages with timestamps < target
            // For desc order (newest first), count messages with timestamps > target
            const countQuery = {
              query: {
                bool: {
                  must: [
                    ...must,
                    { range: { timestamp: sortOrder === 'asc' ? { lt: targetTimestamp } : { gt: targetTimestamp } } }
                  ]
                }
              }
            }
            
            console.log('🔍 API: Count query:', JSON.stringify(countQuery, null, 2))
            
            const countResponse = await openSearchClient.search({
              index: 'messages',
              body: countQuery
            })
            
            const messagesBeforeTarget = countResponse.body.hits.total.value
            targetPage = Math.floor(messagesBeforeTarget / size) + 1
            
            console.log('📊 API: Page calculation:', {
              messagesBeforeTarget,
              size,
              calculatedPage: targetPage,
              originalPage: page
            })
          } else {
            console.log('❌ API: Target message not found in OpenSearch')
          }
        } catch (error) {
          console.error('❌ API: Error finding target page:', error)
        }
      }

    // Get updated display names and profile pictures from database
    const hits = response.body.hits.hits
    const userIds: string[] = [...new Set<string>(hits.map((hit: any) => hit._source.userId as string))]
    
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
      aggregations: response.body.aggregations,
      targetPage: jumpToMessageId ? targetPage : null
    })
  } catch (error) {
    console.error('OpenSearch search error:', error)
    return NextResponse.json(
      { error: 'Failed to search messages' },
      { status: 500 }
    )
  }
}
