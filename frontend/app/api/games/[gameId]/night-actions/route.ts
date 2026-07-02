import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { hasValidGameSession } from '@/lib/game-auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params
    if (!hasValidGameSession(request, gameId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const nightNumber = searchParams.get('nightNumber')

    if (!nightNumber) {
      return NextResponse.json({ error: 'Night number is required' }, { status: 400 })
    }

    const result = await db.getNightActions(gameId, parseInt(nightNumber))
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching night actions:', error)
    return NextResponse.json({ error: 'Failed to fetch night actions' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params
    if (!hasValidGameSession(request, gameId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { playerId, action, nightNumber } = await request.json()

    if (!playerId || !action || !nightNumber) {
      return NextResponse.json({ error: 'Player ID, action, and night number are required' }, { status: 400 })
    }

    await db.saveNightAction(gameId, playerId, action, nightNumber)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving night action:', error)
    return NextResponse.json({ error: 'Failed to save night action' }, { status: 500 })
  }
}
