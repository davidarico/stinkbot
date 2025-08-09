import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

interface RouteParams {
  params: Promise<{ gameId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params

  try {
    const channels = await db.getGameChannels(gameId)
    return NextResponse.json(channels)
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  const body = await request.json()
  const { channelName, channelId, dayMessage, nightMessage, openAtDawn, openAtDusk } = body

  try {
    const result = await db.addGameChannel(gameId, {
      channelName,
      channelId,
      dayMessage,
      nightMessage,
      openAtDawn,
      openAtDusk
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  const body = await request.json()
  const { action, channelId, userId } = body

  try {
    if (action === 'addInvitedUser') {
      const result = await db.addInvitedUserToChannel(gameId, channelId, userId)
      return NextResponse.json(result)
    } else if (action === 'removeInvitedUser') {
      const result = await db.removeInvitedUserFromChannel(gameId, channelId, userId)
      return NextResponse.json(result)
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  const { searchParams } = new URL(request.url)
  const channelId = searchParams.get('channelId')

  if (!channelId) {
    return NextResponse.json({ error: "Channel ID is required" }, { status: 400 })
  }

  try {
    const result = await db.deleteGameChannel(gameId, parseInt(channelId))
    return NextResponse.json(result)
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
} 