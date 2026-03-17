import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await params

    if (!messageId) {
      return NextResponse.json(
        { error: 'Message ID is required' },
        { status: 400 }
      )
    }

    const message = await db.getArchiveMessageByMessageId(messageId)

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      )
    }

    // Enrich with current display name and profile picture
    const userIds = [message._source.userId]
    if (userIds.length > 0) {
      const serverUsers = await db.getServerUsersByUserIds(userIds)
      const userMap = new Map(serverUsers.map(u => [u.user_id, { displayName: u.display_name, profilePictureLink: u.profile_picture_link }]))
      const userInfo = userMap.get(message._source.userId)
      if (userInfo) {
        message._source.displayName = userInfo.displayName
        message._source.profilePictureLink = userInfo.profilePictureLink
      }
    }

    return NextResponse.json({ message })
  } catch (error) {
    console.error('Error getting message by ID:', error)
    return NextResponse.json(
      { error: 'Failed to get message' },
      { status: 500 }
    )
  }
}
