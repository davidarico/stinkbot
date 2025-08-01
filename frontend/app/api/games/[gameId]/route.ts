import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

interface RouteParams {
  params: { gameId: string }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params

  try {
    const game = await db.getGame(gameId)
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

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
      themeName: game.theme_name
    })
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  const body = await request.json()
  const { action, password, isThemed, isSkinned, themeName } = body

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

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
