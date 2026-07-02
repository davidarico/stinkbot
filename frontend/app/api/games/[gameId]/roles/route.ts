import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"
import { hasValidGameSession } from "@/lib/game-auth"

interface RouteParams {
  params: Promise<{ gameId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  if (!hasValidGameSession(request, gameId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const gameRoles = await db.getGameRoles(gameId)
    return NextResponse.json(gameRoles)
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  if (!hasValidGameSession(request, gameId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const { gameRoles } = body

  try {
    const result = await db.saveGameRoles(gameId, gameRoles)
    return NextResponse.json(result)
  } catch (error) {
    console.error("Database error:", error)
    let details = "Unknown error"
    if (error instanceof Error) {
      details = error.message
    }
    return NextResponse.json({ error: "Database error", details }, { status: 500 })
  }
}
