import { NextRequest, NextResponse } from 'next/server'
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

    const messages = await db.getArchiveContext(channelId, timestamp, limit)

    // Enrich with display names and profile pictures
    const userIds = [...new Set(messages.map((m: any) => m._source.userId))]
    if (userIds.length > 0) {
      const serverUsers = await db.getServerUsersByUserIds(userIds)
      const userMap = new Map(serverUsers.map(u => [u.user_id, { displayName: u.display_name, profilePictureLink: u.profile_picture_link }]))
      messages.forEach((hit: any) => {
        const userInfo = userMap.get(hit._source.userId)
        if (userInfo) {
          hit._source.displayName = userInfo.displayName
          hit._source.profilePictureLink = userInfo.profilePictureLink
        }
      })
    }

    return NextResponse.json({ messages })
  } catch (error) {
    console.error('Archive context error:', error)
    return NextResponse.json(
      { error: 'Failed to get message context' },
      { status: 500 }
    )
  }
}
