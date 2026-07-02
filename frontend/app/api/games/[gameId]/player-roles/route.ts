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
    const playerRoles = await db.getPlayerRoles(gameId)
    return NextResponse.json(playerRoles)
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
