import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

interface RouteParams {
  params: { gameId: string }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params

  try {
    const playerRoles = await db.getPlayerRoles(gameId)
    return NextResponse.json(playerRoles)
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
