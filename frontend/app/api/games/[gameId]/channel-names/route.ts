import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"
import { hasValidGameSession } from "@/lib/game-auth"

interface RouteParams {
  params: Promise<{ gameId: string }>
}

// Names of the channels Wolf.start creates (results, town square, ...). Editable only
// while the game is still in signups.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  if (!hasValidGameSession(request, gameId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const channelNames = await db.getCoreChannelNames(gameId)
    if (!channelNames) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }
    return NextResponse.json(channelNames)
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  if (!hasValidGameSession(request, gameId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()

  try {
    const result = await db.updateCoreChannelNames(gameId, body?.names ?? {})
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json(await db.getCoreChannelNames(gameId))
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
