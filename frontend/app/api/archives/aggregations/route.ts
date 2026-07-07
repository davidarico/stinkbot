import { NextResponse } from 'next/server'
import { db } from '@/lib/database'

export async function GET() {
  try {
    const { games, channels, users } = await db.getArchiveAggregations()
    return NextResponse.json({ games, channels, users })
  } catch (error) {
    console.error('Archive aggregations error:', error)
    return NextResponse.json(
      { error: 'Failed to get aggregations' },
      { status: 500 }
    )
  }
}
