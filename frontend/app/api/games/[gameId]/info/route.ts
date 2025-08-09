import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

interface RouteParams {
  params: Promise<{ gameId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params

  try {
    const game = await db.getGame(gameId)
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    const serverConfig = await db.getServerConfig(game.server_id)
    if (!serverConfig) {
      return NextResponse.json({ error: "Server config not found" }, { status: 404 })
    }

    return NextResponse.json({
      gameNumber: game.game_number,
      gamePrefix: serverConfig.game_prefix,
      channelPrefix: `${serverConfig.game_prefix}${game.game_number}`
    })
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
