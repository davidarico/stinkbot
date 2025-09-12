import { NextRequest, NextResponse } from 'next/server'
import { openSearchClient } from '@/lib/opensearch'
import { db } from '@/lib/database'

export async function GET(
  request: NextRequest,
  { params }: { params: { messageId: string } }
) {
  try {
    const messageId = (await params).messageId

    if (!messageId) {
      return NextResponse.json(
        { error: 'Message ID is required' },
        { status: 400 }
      )
    }

    // Search for the message by its Discord message ID
    const searchBody = {
      query: {
        term: {
          messageId: messageId
        }
      },
      size: 1
    }

    const response = await openSearchClient.search({
      index: 'messages',
      body: searchBody
    })

    // Handle different response formats
    const responseData = response.body || response

    if (responseData.hits.hits.length === 0) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      )
    }

    const hit = responseData.hits.hits[0]

    // Get updated display name and profile picture from database
    const userIds = [hit._source.userId]
    
    if (userIds.length > 0) {
      const serverUsers = await db.getServerUsersByUserIds(userIds)
      const userMap = new Map(serverUsers.map(user => [user.user_id, { displayName: user.display_name, profilePictureLink: user.profile_picture_link }]))
      
      const userInfo = userMap.get(hit._source.userId)
      if (userInfo) {
        hit._source.displayName = userInfo.displayName
        hit._source.profilePictureLink = userInfo.profilePictureLink
      }
    }

    return NextResponse.json({
      message: hit
    })
  } catch (error) {
    console.error('Error getting message by ID:', error)
    return NextResponse.json(
      { error: 'Failed to get message' },
      { status: 500 }
    )
  }
}
