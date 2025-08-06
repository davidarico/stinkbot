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