import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

interface RouteParams {
  params: { gameId: string }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params

  try {
    const players = await db.getPlayers(gameId)
    const game = await db.getGame(gameId)
    
    return NextResponse.json(players.map(player => ({
      id: player.id,
      username: player.username,
      status: player.status,
      role: player.role,
      roleId: player.role_id,
      skinnedRole: player.skinned_role,
      alignment: player.is_wolf ? "wolf" : 
                 (player as any).role_team === 'wolf' ? "wolf" : 
                 (player as any).role_team === 'neutral' ? "neutral" : "town",
      userId: player.user_id,
      isFramed: player.is_framed,
      isDead: player.is_dead,
      displayRole: game?.is_skinned && player.skinned_role ? player.skinned_role : player.role
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
