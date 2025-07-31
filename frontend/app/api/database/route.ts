import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get("action")
  const gameId = searchParams.get("gameId")

  try {
    switch (action) {
      case "getGame":
        if (!gameId) {
          return NextResponse.json({ error: "Game ID required" }, { status: 400 })
        }
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
          categoryId: game.category_id
        })

      case "getPlayers":
        if (!gameId) {
          return NextResponse.json({ error: "Game ID required" }, { status: 400 })
        }
        const players = await db.getPlayers(gameId)
        return NextResponse.json(players.map(player => ({
          id: player.id,
          username: player.username,
          status: player.status,
          role: player.role,
          alignment: player.is_wolf ? "wolf" : player.role?.toLowerCase().includes("wolf") ? "wolf" : "town", // Simplified alignment logic
          userId: player.user_id
        })))

      case "getRoles":
        const roles = await db.getRoles()
        return NextResponse.json(roles)

      case "getVotes":
        if (!gameId) {
          return NextResponse.json({ error: "Game ID required" }, { status: 400 })
        }
        const dayNumber = parseInt(searchParams.get("dayNumber") || "1")
        const votes = await db.getVotes(gameId, dayNumber)
        return NextResponse.json(votes.map((vote: any) => ({
          voterUsername: vote.voter_username,
          targetUsername: vote.target_username
        })))

      case "verifyPassword":
        if (!gameId) {
          return NextResponse.json({ error: "Game ID required" }, { status: 400 })
        }
        const password = searchParams.get("password")
        if (!password) {
          return NextResponse.json({ error: "Password required" }, { status: 400 })
        }
        const isValid = await db.verifyGamePassword(gameId, password)
        return NextResponse.json({ valid: isValid })

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { action, gameId, data } = body

  try {
    switch (action) {
      case "assignRoles":
        if (!gameId || !data?.assignments) {
          return NextResponse.json({ error: "Game ID and assignments required" }, { status: 400 })
        }
        const result = await db.assignRoles(gameId, data.assignments)
        return NextResponse.json(result)

      case "updatePlayer":
        if (!data?.playerId || !data?.status) {
          return NextResponse.json({ error: "Player ID and status required" }, { status: 400 })
        }
        const updatedPlayer = await db.updatePlayerStatus(data.playerId, data.status)
        return NextResponse.json(updatedPlayer)

      case "addVote":
        if (!gameId || !data?.voterUserId || !data?.targetUserId || !data?.dayNumber) {
          return NextResponse.json({ error: "Missing required vote data" }, { status: 400 })
        }
        const voteResult = await db.addVote(gameId, data.voterUserId, data.targetUserId, data.dayNumber)
        return NextResponse.json(voteResult)

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
