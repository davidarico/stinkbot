"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface SleepwalkerComponentProps {
  playerName: string
  isFramed?: boolean
}

export function SleepwalkerComponent({ playerName, isFramed }: SleepwalkerComponentProps) {
  const [avoid1, setAvoid1] = useState("")
  const [avoid2, setAvoid2] = useState("")
  const [result, setResult] = useState("")

  const generateResult = () => {
    // Mock logic for sleepwalker
    const alivePlayers = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank"]
    const availablePlayers = alivePlayers.filter((p) => p !== playerName && p !== avoid1 && p !== avoid2)

    if (availablePlayers.length > 0) {
      const visited = availablePlayers[Math.floor(Math.random() * availablePlayers.length)]
      setResult(`${playerName} visited ${visited}`)
    }
  }

  return (
    <Card className="mt-2">
      <CardHeader>
        <CardTitle className="text-sm">Sleepwalker Action</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Avoid 1" value={avoid1} onChange={(e) => setAvoid1(e.target.value)} />
          <Input placeholder="Avoid 2" value={avoid2} onChange={(e) => setAvoid2(e.target.value)} />
        </div>
        <Button onClick={generateResult} size="sm" className="w-full">
          Generate Visit
        </Button>
        {result && (
          <div className="p-2 bg-blue-50 rounded text-sm">
            {result}
            {isFramed && (
              <Badge variant="destructive" className="ml-2">
                Framed Result
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface BartenderComponentProps {
  playerName: string
  isFramed?: boolean
}

export function BartenderComponent({ playerName, isFramed }: BartenderComponentProps) {
  const [target, setTarget] = useState("")
  const [result, setResult] = useState("")

  const generateResult = () => {
    if (!target) return

    // Mock logic for bartender
    const roles = ["Villager", "Seer", "Doctor", "Werewolf", "Alpha Wolf"]
    const actualRole = roles[Math.floor(Math.random() * roles.length)]
    const randomRole1 = roles[Math.floor(Math.random() * roles.length)]
    const randomRole2 = roles[Math.floor(Math.random() * roles.length)]

    if (isFramed) {
      // If framed, show incorrect information
      const wrongRoles = roles.filter((r) => r !== actualRole)
      const framedRole = wrongRoles[Math.floor(Math.random() * wrongRoles.length)]
      setResult(`${target} appears to be: ${framedRole}, ${randomRole1}, ${randomRole2}`)
    } else {
      setResult(`${target} could be: ${actualRole}, ${randomRole1}, ${randomRole2}`)
    }
  }

  return (
    <Card className="mt-2">
      <CardHeader>
        <CardTitle className="text-sm">Bartender Action</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input placeholder="Target player" value={target} onChange={(e) => setTarget(e.target.value)} />
        <Button onClick={generateResult} size="sm" className="w-full">
          Serve Drink
        </Button>
        {result && (
          <div className="p-2 bg-blue-50 rounded text-sm">
            {result}
            {isFramed && (
              <Badge variant="destructive" className="ml-2">
                Framed Result
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface SeerComponentProps {
  playerName: string
  isFramed?: boolean
}

export function SeerComponent({ playerName, isFramed }: SeerComponentProps) {
  const [target, setTarget] = useState("")
  const [result, setResult] = useState("")

  const generateResult = () => {
    if (!target) return

    // Mock logic for seer
    const alignments = ["Town", "Wolf", "Neutral"]
    const actualAlignment = alignments[Math.floor(Math.random() * alignments.length)]

    if (isFramed) {
      // If target is framed, show as Wolf regardless of actual alignment
      setResult(`${target} appears to be: Wolf`)
    } else {
      setResult(`${target} is: ${actualAlignment}`)
    }
  }

  return (
    <Card className="mt-2">
      <CardHeader>
        <CardTitle className="text-sm">Seer Investigation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input placeholder="Target player" value={target} onChange={(e) => setTarget(e.target.value)} />
        <Button onClick={generateResult} size="sm" className="w-full">
          Investigate
        </Button>
        {result && <div className="p-2 bg-blue-50 rounded text-sm">{result}</div>}
      </CardContent>
    </Card>
  )
}
