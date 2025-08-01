import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

interface RouteParams {
  params: { gameId: string }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params

  try {
    const players = await db.getPlayers(gameId)
    return NextResponse.json(players.map(player => ({
      id: player.id,
      username: player.username,
      status: player.status,
      role: player.role,
      alignment: player.is_wolf ? "wolf" : player.role?.toLowerCase().includes("wolf") ? "wolf" : "town", // Simplified alignment logic
      userId: player.user_id
    })))
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  const body = await request.json()
  const { action, data } = body

  try {
    switch (action) {
      case "assignRoles":
        if (!data?.assignments) {
          return NextResponse.json({ error: "Assignments required" }, { status: 400 })
        }
        const result = await db.assignRoles(gameId, data.assignments)
        return NextResponse.json(result)

      case "updatePlayer":
        if (!data?.playerId || !data?.status) {
          return NextResponse.json({ error: "Player ID and status required" }, { status: 400 })
        }
        const updatedPlayer = await db.updatePlayerStatus(data.playerId, data.status)
        return NextResponse.json(updatedPlayer)

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
