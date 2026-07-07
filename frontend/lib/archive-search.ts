import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

export async function handleArchiveSearch(request: NextRequest, onlyBaseballServer: boolean) {
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

    const { messages, total, targetPage } = await db.searchArchiveMessages({
      query: query || undefined,
      game: game || undefined,
      channel: channel || undefined,
      user: user || undefined,
      from,
      size,
      jumpToMessageId: jumpToMessageId || undefined,
      onlyBaseballServer
    })

    // Enrich with current display names and profile pictures from server_users
    const userIds: string[] = [...new Set<string>(
      messages.flatMap((m: any) => [m.userId, m.replyPreview?.userId].filter(Boolean))
    )]

    if (userIds.length > 0) {
      const serverUsers = await db.getServerUsersByUserIds(userIds)
      const userMap = new Map(serverUsers.map(u => [u.user_id, { displayName: u.display_name, profilePictureLink: u.profile_picture_link }]))
      messages.forEach((message: any) => {
        const userInfo = userMap.get(message.userId)
        if (userInfo) {
          message.displayName = userInfo.displayName
          message.profilePictureLink = userInfo.profilePictureLink
        }
        const replyUserInfo = message.replyPreview?.userId ? userMap.get(message.replyPreview.userId) : undefined
        if (replyUserInfo) {
          message.replyPreview.displayName = replyUserInfo.displayName
        }
      })
    }

    return NextResponse.json({ messages, total, targetPage })
  } catch (error) {
    console.error('Archive search error:', error)
    return NextResponse.json(
      { error: 'Failed to search messages' },
      { status: 500 }
    )
  }
}

export async function handleArchiveAggregations(onlyBaseballServer: boolean) {
  try {
    const { games, channels, users } = await db.getArchiveAggregations(onlyBaseballServer)
    return NextResponse.json({ games, channels, users })
  } catch (error) {
    console.error('Archive aggregations error:', error)
    return NextResponse.json(
      { error: 'Failed to get aggregations' },
      { status: 500 }
    )
  }
}
