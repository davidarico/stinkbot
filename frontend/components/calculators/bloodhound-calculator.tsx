"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Player {
  username: string
  status: "alive" | "dead"
}

interface Role {
  id: number
  name: string
  alignment: "town" | "wolf" | "neutral"
}

interface BloodhoundCalculatorProps {
  players: Player[]
  gameRoles: Role[]
}

/**
 * Lightweight "generator" for Bloodhound-style night lines (feedback #17).
 * Does not implement full rules — picks among alive players for flavor text.
 */
export function BloodhoundCalculator({ players, gameRoles }: BloodhoundCalculatorProps) {
  const alive = useMemo(() => players.filter((p) => p.status === "alive"), [players])
  const townRoles = useMemo(
    () => gameRoles.filter((r) => r.alignment === "town").sort((a, b) => a.name.localeCompare(b.name)),
    [gameRoles]
  )

  const [searchRoleId, setSearchRoleId] = useState<string>(
    townRoles[0] ? String(townRoles[0].id) : ""
  )
  const [output, setOutput] = useState<string>("")

  const generate = () => {
    const role = townRoles.find((r) => String(r.id) === searchRoleId)
    if (!role || alive.length === 0) {
      setOutput("Need at least one alive player and a town role to search for.")
      return
    }
    const shuffled = [...alive].sort(() => Math.random() - 0.5)
    const hits = shuffled.slice(0, Math.min(3, shuffled.length)).map((p) => p.username)
    const miss = Math.random() < 0.25
    if (miss) {
      setOutput(`Bloodhound searched for **${role.name}** and found **no one** among the sampled houses tonight.`)
    } else {
      setOutput(
        `Bloodhound searched for **${role.name}** and found: **${hits.join("**, **")}** (randomized sample for table use — verify against your actual night info).`
      )
    }
  }

  if (!townRoles.length) {
    return null
  }

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-white text-base">Bloodhound line generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label className="text-gray-300">Role to &quot;search&quot; for</Label>
          <Select value={searchRoleId} onValueChange={setSearchRoleId}>
            <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
              <SelectValue placeholder="Pick a town role" />
            </SelectTrigger>
            <SelectContent>
              {townRoles.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="secondary" onClick={generate} className="w-full">
          Generate sample line
        </Button>
        {output && (
          <p className="text-sm text-gray-200 whitespace-pre-wrap border border-white/10 rounded-md p-3 bg-black/20">
            {output}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
