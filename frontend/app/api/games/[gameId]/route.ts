import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"
import { hasValidGameSession, setGameSession, verifyPasswordHash } from "@/lib/game-auth"
import { timingSafeEqual } from "crypto"

interface RouteParams {
  params: Promise<{ gameId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  if (!hasValidGameSession(request, gameId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
      isThemed: game.is_themed,
      isSkinned: game.is_skinned,
      themeName: game.theme_name,
      dayMessage: game.day_message,
      nightMessage: game.night_message,
      wolfDayMessage: game.wolf_day_message,
      wolfNightMessage: game.wolf_night_message,
      serverId: game.server_id,
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
        const credentials = await db.getGamePasswordCredentials(gameId)
        if (!credentials) return NextResponse.json({ valid: false })

        let isValid = credentials.passwordHash
          ? verifyPasswordHash(password, credentials.passwordHash)
          : false

        // Temporary compatibility for games created before the password migration.
        if (!credentials.passwordHash && credentials.legacyCategoryId) {
          const supplied = Buffer.from(password)
          const expected = Buffer.from(credentials.legacyCategoryId)
          isValid = supplied.length === expected.length && timingSafeEqual(supplied, expected)
        }

        const response = NextResponse.json({ valid: isValid })
        if (isValid && !setGameSession(response, gameId)) {
          return NextResponse.json({ error: "Game sessions are not configured" }, { status: 500 })
        }
        return response

      case "updateTheme":
        if (!hasValidGameSession(request, gameId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        const result = await db.updateGameTheme(gameId, isThemed, isSkinned, themeName)
        return NextResponse.json(result)

      case "updateSettings":
        if (!hasValidGameSession(request, gameId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
