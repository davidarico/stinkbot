"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface RiggedSlot {
  sortIndex: number
  roleId: number
  roleName: string
  roleTeam: string
  customName: string | null
}

interface RiggedPlayer {
  id: number
  username: string
  currentRole: string | null
}

interface RiggedGame {
  id: number
  gameNumber: number
  gameName?: string
  isSkinned: boolean
  isThemed: boolean
}

const teamColor = (team: string) =>
  team === "wolf" ? "text-red-500 dark:text-red-400"
    : team === "neutral" ? "text-amber-500 dark:text-amber-400"
      : "text-blue-500 dark:text-blue-400"

export default function RiggedPage() {
  const [password, setPassword] = useState("")
  const [unlocked, setUnlocked] = useState(false)
  const [game, setGame] = useState<RiggedGame | null>(null)
  const [players, setPlayers] = useState<RiggedPlayer[]>([])
  const [slots, setSlots] = useState<RiggedSlot[]>([])
  const [selection, setSelection] = useState<Record<number, number | "">>({})
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/rigged", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, ...body }),
    })
    const data = await response.json().catch(() => ({}))
    return { ok: response.ok, data }
  }

  const unlock = async () => {
    setLoading(true)
    setMessage(null)
    const { ok, data } = await post({ action: "load" })
    setLoading(false)
    if (!ok) {
      setMessage(data.error || "Failed to load")
      return
    }
    setGame(data.game)
    setPlayers(data.players)
    setSlots(data.slots)
    setSelection(Object.fromEntries(data.players.map((p: RiggedPlayer) => [p.id, ""])))
    setUnlocked(true)
  }

  const slotLabel = (slot: RiggedSlot) => {
    const base = slot.customName ? `${slot.roleName} (${slot.customName})` : slot.roleName
    return `#${slot.sortIndex + 1} ${base}`
  }

  const usedSortIndexes = new Set(
    Object.values(selection).filter(value => value !== "") as number[]
  )

  const save = async () => {
    const assignments = players.map(player => ({
      playerId: player.id,
      gameRoleSortIndex: selection[player.id],
    }))

    if (assignments.some(a => a.gameRoleSortIndex === "")) {
      setMessage("Assign a role to every player first")
      return
    }

    setLoading(true)
    setMessage(null)
    const { ok, data } = await post({ action: "assign", assignments })
    if (!ok) {
      setLoading(false)
      setMessage(data.error || "Failed to assign roles")
      return
    }

    const reload = await post({ action: "load" })
    setLoading(false)
    if (reload.ok) {
      setPlayers(reload.data.players)
    }
    setMessage("Roles assigned.")
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold text-center">
          Truth is kid, it was rigged from the start
        </h1>

        {!unlocked ? (
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                onKeyDown={event => event.key === "Enter" && unlock()}
                placeholder="Password"
              />
              <Button onClick={unlock} disabled={loading || !password} className="w-full">
                {loading ? "Checking..." : "Enter"}
              </Button>
              {message && <p className="text-sm text-red-500 dark:text-red-400">{message}</p>}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                Game {game?.gameNumber}{game?.gameName ? ` - ${game.gameName}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {slots.length !== players.length && (
                <p className="text-sm text-amber-500 dark:text-amber-400">
                  {slots.length} role slots for {players.length} players - set the breakdown on the
                  dashboard first.
                </p>
              )}

              <div className="space-y-2">
                {players.map(player => (
                  <div
                    key={player.id}
                    className="flex items-center gap-3 border border-border rounded-md p-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{player.username}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        current: {player.currentRole || "none"}
                      </div>
                    </div>
                    <select
                      className="bg-card border border-border rounded-md px-2 py-1 text-sm max-w-[55%]"
                      value={selection[player.id] ?? ""}
                      onChange={event =>
                        setSelection(prev => ({
                          ...prev,
                          [player.id]: event.target.value === "" ? "" : Number(event.target.value),
                        }))
                      }
                    >
                      <option value="">-- pick a role --</option>
                      {slots.map(slot => (
                        <option
                          key={slot.sortIndex}
                          value={slot.sortIndex}
                          disabled={
                            usedSortIndexes.has(slot.sortIndex) &&
                            selection[player.id] !== slot.sortIndex
                          }
                        >
                          {slotLabel(slot)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="text-xs text-muted-foreground">
                {slots.map(slot => (
                  <span key={slot.sortIndex} className="mr-3 whitespace-nowrap">
                    <span className={teamColor(slot.roleTeam)}>{slotLabel(slot)}</span>
                  </span>
                ))}
              </div>

              <Button onClick={save} disabled={loading} className="w-full">
                {loading ? "Saving..." : "Assign Roles"}
              </Button>
              {message && <p className="text-sm text-muted-foreground">{message}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
