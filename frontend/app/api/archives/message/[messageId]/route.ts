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
    const serverUsers = await db.getServerUsersByUserIds([message.userId])
    if (serverUsers.length > 0) {
      message.displayName = serverUsers[0].display_name
      message.profilePictureLink = serverUsers[0].profile_picture_link
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
