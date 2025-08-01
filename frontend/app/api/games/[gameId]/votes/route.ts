import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/database"

interface RouteParams {
  params: { gameId: string }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  const { searchParams } = new URL(request.url)
  const dayNumber = parseInt(searchParams.get("dayNumber") || "1")

  try {
    const votes = await db.getVotes(gameId, dayNumber)
    return NextResponse.json(votes.map((vote: any) => ({
      voterUsername: vote.voter_username,
      targetUsername: vote.target_username
    })))
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { gameId } = await params
  const body = await request.json()
  const { voterUserId, targetUserId, dayNumber } = body

  try {
    if (!voterUserId || !targetUserId || !dayNumber) {
      return NextResponse.json({ error: "Missing required vote data" }, { status: 400 })
    }

    const voteResult = await db.addVote(gameId, voterUserId, targetUserId, dayNumber)
    return NextResponse.json(voteResult)
  } catch (error) {
    console.error("Database error:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
