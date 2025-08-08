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

    // Get server configuration for game counter and name
    const serverConfig = await db.getServerConfig(game.server_id)

    return NextResponse.json({
      id: game.id.toString(),
      status: game.status,
      phase: game.status === 'signup' ? 'signup' : game.day_phase,
      dayNumber: game.day_number,
      votesToHang: game.votes_to_hang,
      gameName: game.game_name,
      categoryId: game.category_id,
      isThemed: game.is_themed,
      isSkinned: game.is_skinned,
      themeName: game.theme_name,
      dayMessage: game.day_message,
      nightMessage: game.night_message,
      wolfDayMessage: game.wolf_day_message,
      wolfNightMessage: game.wolf_night_message,
      serverConfig: serverConfig ? {
        gameCounter: serverConfig.game_counter,
        gameName: serverConfig.game_name
      } : null
    })
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  const body = await request.json()
  const { action, password, isThemed, isSkinned, themeName, settings } = body

  try {
    switch (action) {
      case "verifyPassword":
        if (!password) {
          return NextResponse.json({ error: "Password required" }, { status: 400 })
        }
        const isValid = await db.verifyGamePassword(gameId, password)
        return NextResponse.json({ valid: isValid })

      case "updateTheme":
        const result = await db.updateGameTheme(gameId, isThemed, isSkinned, themeName)
        return NextResponse.json(result)

      case "updateSettings":
        const settingsResult = await db.updateGameSettings(gameId, settings)
        return NextResponse.json(settingsResult)

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
