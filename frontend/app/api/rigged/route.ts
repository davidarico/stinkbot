import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

// Temporary rigged-assignment endpoint. Locked to a single game.
const RIGGED_GAME_ID = "223"
const RIGGED_GAME_NUMBER = 543

function passwordOk(password: unknown): boolean {
  const expected = process.env.RIGGED_PASSWORD
  if (!expected) return false
  return typeof password === "string" && password === expected
}

async function loadRiggedGame() {
  const game = await db.getGame(RIGGED_GAME_ID)
  if (!game || game.game_number !== RIGGED_GAME_NUMBER) return null
  return game
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { password, action, assignments } = body ?? {}

  if (!passwordOk(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 })
  }

  try {
    const game = await loadRiggedGame()
    if (!game) {
      return NextResponse.json({ error: "Rigged game not available" }, { status: 404 })
    }

    if (action === "load") {
      const players = await db.getPlayers(RIGGED_GAME_ID)
      const gameRoles = await db.getGameRoles(RIGGED_GAME_ID)

      return NextResponse.json({
        game: {
          id: game.id,
          gameNumber: game.game_number,
          gameName: game.game_name,
          isSkinned: game.is_skinned,
          isThemed: game.is_themed,
        },
        players: players.map(player => ({
          id: player.id,
          username: player.username,
          currentRole: player.role ?? null,
        })),
        slots: gameRoles.map((gr: any) => ({
          sortIndex: gr.sort_index,
          roleId: gr.role_id,
          roleName: gr.role_name,
          roleTeam: gr.role_team,
          customName: gr.custom_name ?? null,
        })),
      })
    }

    if (action === "assign") {
      if (!Array.isArray(assignments) || assignments.length === 0) {
        return NextResponse.json({ error: "Assignments required" }, { status: 400 })
      }

      const players = await db.getPlayers(RIGGED_GAME_ID)
      const gameRoles = await db.getGameRoles(RIGGED_GAME_ID)
      const playerIds = new Set(players.map(p => p.id))
      const slotBySortIndex = new Map(gameRoles.map((gr: any) => [gr.sort_index, gr]))

      if (assignments.length !== players.length) {
        return NextResponse.json({ error: "Every player must be assigned a role" }, { status: 400 })
      }

      const usedSlots = new Set<number>()
      const usedPlayers = new Set<number>()
      const resolved = []

      for (const assignment of assignments) {
        const playerId = Number(assignment?.playerId)
        const sortIndex = Number(assignment?.gameRoleSortIndex)

        if (!playerIds.has(playerId) || usedPlayers.has(playerId)) {
          return NextResponse.json({ error: "Invalid or duplicate player" }, { status: 400 })
        }
        const slot: any = slotBySortIndex.get(sortIndex)
        if (!slot || usedSlots.has(sortIndex)) {
          return NextResponse.json({ error: "Invalid or duplicate role slot" }, { status: 400 })
        }
        usedPlayers.add(playerId)
        usedSlots.add(sortIndex)

        resolved.push({
          playerId,
          roleId: slot.role_id,
          isWolf: slot.role_team === "wolf",
          skinnedRole: game.is_skinned ? slot.role_name : undefined,
          thematicCustomName: game.is_themed ? (slot.custom_name?.trim() || null) : null,
          gameRoleSortIndex: slot.sort_index,
        })
      }

      await db.assignRoles(RIGGED_GAME_ID, resolved)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Rigged assignment error:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
