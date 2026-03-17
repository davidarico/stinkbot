import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

export async function GET(request: NextRequest) {
  try {
    const aggregations = await db.getArchiveAggregations()

    return NextResponse.json({
      aggregations: {
        games: aggregations.games,
        channels: aggregations.channels,
        users: aggregations.users
      }
    })
  } catch (error) {
    console.error('Archive aggregations error:', error)
    return NextResponse.json(
      { error: 'Failed to get aggregations' },
      { status: 500 }
    )
  }
}
