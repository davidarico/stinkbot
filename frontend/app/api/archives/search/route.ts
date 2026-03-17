import { NextRequest, NextResponse } from 'next/server'
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

    const response = await db.searchArchiveMessages({
      query: query || undefined,
      game: game || undefined,
      channel: channel || undefined,
      user: user || undefined,
      from,
      size,
      jumpToMessageId: jumpToMessageId || undefined
    })

    // Enrich hits with current display names and profile pictures from server_users
    const hits = response.hits.hits
    const userIds: string[] = [...new Set<string>(hits.map((hit: any) => hit._source.userId as string))]

    if (userIds.length > 0) {
      const serverUsers = await db.getServerUsersByUserIds(userIds)
      const userMap = new Map(serverUsers.map(u => [u.user_id, { displayName: u.display_name, profilePictureLink: u.profile_picture_link }]))
      hits.forEach((hit: any) => {
        const userInfo = userMap.get(hit._source.userId)
        if (userInfo) {
          hit._source.displayName = userInfo.displayName
          hit._source.profilePictureLink = userInfo.profilePictureLink
        }
      })
    }

    return NextResponse.json({
      hits: response.hits,
      aggregations: response.aggregations,
      targetPage: response.targetPage
    })
  } catch (error) {
    console.error('Archive search error:', error)
    return NextResponse.json(
      { error: 'Failed to search messages' },
      { status: 500 }
    )
  }
}
