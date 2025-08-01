"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Search, Users, Shuffle, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"

interface Player {
  id: number
  username: string
  status: "alive" | "dead"
  role?: string
  alignment?: string
  isFramed?: boolean
  actionNotes?: string
}

interface Role {
  id: number
  name: string
  alignment: "town" | "wolf" | "neutral"
  description: string
  metadata?: string
  hasInfoFunction?: boolean
}

interface GameData {
  id: string
  phase: "signup" | "night" | "day"
  dayNumber: number
  votesToHang: number
}

interface Vote {
  voterUsername: string
  targetUsername: string
}

export default function GameManagementPage() {
  const params = useParams()
  const gameId = params.gameId as string

  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [gameData, setGameData] = useState<GameData>({
    id: gameId,
    phase: "signup",
    dayNumber: 1,
    votesToHang: 4,
  })

  const [players, setPlayers] = useState<Player[]>([])
  const [availableRoles, setAvailableRoles] = useState<Role[]>([])

  const [selectedRoles, setSelectedRoles] = useState<Role[]>([])
  const [roleSearch, setRoleSearch] = useState("")
  const [votes, setVotes] = useState<Vote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  useEffect(() => {
    // Check if user is already authenticated for this game
    const authCookie = document.cookie.split("; ").find((row) => row.startsWith(`game_${gameId}_auth=`))

    if (authCookie) {
      setIsAuthenticated(true)
      loadGameData()
    } else {
      setLoading(false)
    }
  }, [gameId])

  const loadGameData = async () => {
    try {
      setLoading(true)
      
      // Load game info
      const gameResponse = await fetch(`/api/games/${gameId}`)
      if (gameResponse.ok) {
        const game = await gameResponse.json()
        setGameData({
          id: game.id,
          phase: game.phase,
          dayNumber: game.dayNumber,
          votesToHang: game.votesToHang,
        })
      }

      // Load players
      const playersResponse = await fetch(`/api/games/${gameId}/players`)
      if (playersResponse.ok) {
        const playersData = await playersResponse.json()
        setPlayers(playersData)
      }

      // Load votes for current day
      const votesResponse = await fetch(`/api/games/${gameId}/votes?dayNumber=${gameData.dayNumber}`)
      if (votesResponse.ok) {
        const votesData = await votesResponse.json()
        setVotes(votesData)
      }

      // Load roles
      const rolesResponse = await fetch(`/api/roles`)
      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json()
        setAvailableRoles(rolesData)
      }

    } catch (err) {
      setError('Failed to load game data')
      console.error('Error loading game data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async () => {
    if (!password.trim()) {
      alert("Please enter a password")
      return
    }
    
    try {
      setLoginLoading(true)
      const response = await fetch(`/api/games/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verifyPassword',
          password
        })
      })
      const result = await response.json()
      
      if (result.valid) {
        setIsAuthenticated(true)
        // Set cookie for this game
        document.cookie = `game_${gameId}_auth=true; path=/; max-age=86400`
        await loadGameData()
      } else {
        alert("Incorrect password. Please use the category ID from Discord.")
      }
    } catch (err) {
      alert("Error verifying password")
      console.error('Login error:', err)
    } finally {
      setLoginLoading(false)
    }
  }

  const addRoleToGame = (role: Role) => {
    // Always add the role, allowing duplicates
    setSelectedRoles([...selectedRoles, role])
  }

  const removeRoleFromGame = (roleIndex: number) => {
    setSelectedRoles(selectedRoles.filter((_, index) => index !== roleIndex))
  }

  const assignRoles = async () => {
    if (selectedRoles.length !== players.length) {
      alert(`Need exactly ${players.length} roles for ${players.length} players`)
      return
    }

    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5)
    const shuffledRoles = [...selectedRoles].sort(() => Math.random() - 0.5)

    const assignments = shuffledPlayers.map((player, index) => ({
      playerId: player.id,
      role: shuffledRoles[index].name,
      isWolf: shuffledRoles[index].alignment === "wolf"
    }))

    try {
      const response = await fetch(`/api/games/${gameId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assignRoles',
          data: { assignments }
        })
      })

      if (response.ok) {
        // Update local state
        const updatedPlayers = shuffledPlayers.map((player, index) => ({
          ...player,
          role: shuffledRoles[index].name,
          alignment: shuffledRoles[index].alignment,
        }))
        setPlayers(updatedPlayers)
      } else {
        alert('Failed to assign roles')
      }
    } catch (error) {
      console.error('Error assigning roles:', error)
      alert('Error assigning roles')
    }
  }

  const togglePlayerStatus = async (playerId: number) => {
    const player = players.find(p => p.id === playerId)
    if (!player) return

    const newStatus = player.status === "alive" ? "dead" : "alive"

    try {
      const response = await fetch(`/api/games/${gameId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updatePlayer', 
          data: { playerId, status: newStatus }
        })
      })

      if (response.ok) {
        setPlayers(
          players.map((player) =>
            player.id === playerId ? { ...player, status: newStatus } : player,
          ),
        )
      } else {
        alert('Failed to update player status')
      }
    } catch (error) {
      console.error('Error updating player status:', error)
      alert('Error updating player status')
    }
  }

  const toggleFramed = (playerId: number) => {
    setPlayers(players.map((player) => (player.id === playerId ? { ...player, isFramed: !player.isFramed } : player)))
  }

  const updateActionNotes = (playerId: number, notes: string) => {
    setPlayers(players.map((player) => (player.id === playerId ? { ...player, actionNotes: notes } : player)))
  }

  const filteredRoles = availableRoles.filter((role) => role.name.toLowerCase().includes(roleSearch.toLowerCase()))

  const roleCount = {
    town: selectedRoles.filter((r) => r.alignment === "town").length,
    wolf: selectedRoles.filter((r) => r.alignment === "wolf").length,
    neutral: selectedRoles.filter((r) => r.alignment === "neutral").length,
  }

  const assignedRoleCount = {
    town: players.filter((p) => p.alignment === "town").length,
    wolf: players.filter((p) => p.alignment === "wolf").length,
    neutral: players.filter((p) => p.alignment === "neutral").length,
  }

  const voteCount = votes.reduce(
    (acc, vote) => {
      acc[vote.targetUsername] = (acc[vote.targetUsername] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  const isDayPhase = gameData.phase === "day"

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 to-indigo-900 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Game Access Required</CardTitle>
            <p className="text-sm text-gray-600">Enter the category ID from Discord to access this game.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="password"
              placeholder="Enter game password (category ID)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && !loginLoading && handleLogin()}
              disabled={loginLoading}
            />
            <Button onClick={handleLogin} className="w-full" disabled={loginLoading}>
              {loginLoading ? "Verifying..." : "Access Game"}
            </Button>
            {loading && <p className="text-sm text-gray-500 text-center">Loading...</p>}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 to-indigo-900 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="text-center py-8">
            <p className="text-lg">Loading game data...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 to-indigo-900 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="text-center py-8">
            <p className="text-lg text-red-600">Error: {error}</p>
            <Button onClick={() => window.location.reload()} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "min-h-screen transition-colors duration-1000",
        isDayPhase
          ? "bg-gradient-to-br from-yellow-100 via-orange-100 to-red-100"
          : "bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900",
      )}
    >
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div
          className={cn(
            "flex justify-between items-center mb-8 p-4 rounded-lg",
            isDayPhase ? "bg-white/80 text-gray-900" : "bg-white/10 text-white",
          )}
        >
          <div>
            <h1 className="text-3xl font-bold">Game {gameId}</h1>
            <p className="text-lg flex items-center gap-2">
              {isDayPhase ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              {gameData.phase === "signup"
                ? "Sign Up Phase"
                : gameData.phase === "night"
                  ? `Night ${gameData.dayNumber}`
                  : `Day ${gameData.dayNumber}`}
            </p>
            <p className="text-sm opacity-75 mt-1">
              Phase changes are managed by the Discord bot
            </p>
          </div>
        </div>

        {gameData.phase === "signup" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Signed Up Players */}
            <Card className={isDayPhase ? "bg-white/90" : "bg-white/10"}>
              <CardHeader>
                <CardTitle className={cn("flex items-center gap-2", isDayPhase ? "text-gray-900" : "text-white")}>
                  <Users className="w-5 h-5" />
                  Signed Up Players ({players.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {players.map((player) => (
                    <div
                      key={player.id}
                      className={cn(
                        "p-2 rounded border",
                        isDayPhase ? "bg-white border-gray-200" : "bg-white/5 border-white/20",
                      )}
                    >
                      <span className={isDayPhase ? "text-gray-900" : "text-white"}>{player.username}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Role Selection */}
            <Card className={isDayPhase ? "bg-white/90" : "bg-white/10"}>
              <CardHeader>
                <CardTitle className={cn(isDayPhase ? "text-gray-900" : "text-white")}>
                  Selected Roles ({selectedRoles.length})
                </CardTitle>
                <div className="flex gap-4 text-sm">
                  <span className={cn("text-blue-600", isDayPhase ? "" : "text-blue-300")}>Town: {roleCount.town}</span>
                  <span className={cn("text-red-600", isDayPhase ? "" : "text-red-300")}>Wolves: {roleCount.wolf}</span>
                  <span className={cn("text-yellow-600", isDayPhase ? "" : "text-yellow-300")}>
                    Neutral: {roleCount.neutral}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search roles..."
                    value={roleSearch}
                    onChange={(e) => setRoleSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {filteredRoles.map((role) => {
                    const selectedCount = selectedRoles.filter(r => r.id === role.id).length
                    return (
                      <div
                        key={role.id}
                        className={cn(
                          "p-2 rounded border cursor-pointer hover:bg-opacity-80 transition-colors",
                          isDayPhase
                            ? "bg-white border-gray-200 hover:bg-gray-50"
                            : "bg-white/5 border-white/20 hover:bg-white/10",
                          selectedCount > 0 && (isDayPhase ? "ring-2 ring-blue-200" : "ring-2 ring-blue-500/30")
                        )}
                        onClick={() => addRoleToGame(role)}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                {role.name}
                              </span>
                              <Badge
                                variant={
                                  role.alignment === "town"
                                    ? "default"
                                    : role.alignment === "wolf"
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="text-xs"
                              >
                                {role.alignment}
                              </Badge>
                              {selectedCount > 0 && (
                                <Badge variant="outline" className="text-xs bg-blue-50">
                                  {selectedCount} selected
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-2">
                  {/* Group selected roles by name and show counts */}
                  {Object.entries(
                    selectedRoles.reduce((acc, role, index) => {
                      if (!acc[role.name]) {
                        acc[role.name] = { role, count: 0, indices: [] }
                      }
                      acc[role.name].count++
                      acc[role.name].indices.push(index)
                      return acc
                    }, {} as Record<string, { role: Role; count: number; indices: number[] }>)
                  ).map(([roleName, { role, count, indices }]) => (
                    <div
                      key={roleName}
                      className={cn(
                        "p-2 rounded border flex justify-between items-center",
                        isDayPhase ? "bg-green-50 border-green-200" : "bg-green-900/20 border-green-700",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn(isDayPhase ? "text-gray-900" : "text-white")}>{role.name}</span>
                        <Badge
                          variant={
                            role.alignment === "town"
                              ? "default"
                              : role.alignment === "wolf"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-xs"
                        >
                          {role.alignment}
                        </Badge>
                        {count > 1 && (
                          <Badge variant="outline" className="text-xs">
                            x{count}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => addRoleToGame(role)}
                          className="px-2 py-1 h-6"
                        >
                          +
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive" 
                          onClick={() => removeRoleFromGame(indices[indices.length - 1])}
                          className="px-2 py-1 h-6"
                        >
                          -
                        </Button>
                      </div>
                    </div>
                  ))}
                  {selectedRoles.length === 0 && (
                    <p className={cn("text-center py-4", isDayPhase ? "text-gray-500" : "text-gray-300")}>
                      No roles selected. Click on roles above to add them.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Role Assignments */}
            <Card className={isDayPhase ? "bg-white/90" : "bg-white/10"}>
              <CardHeader>
                <CardTitle className={cn(isDayPhase ? "text-gray-900" : "text-white")}>Role Assignments</CardTitle>
                {players.some((p) => p.role) && (
                  <div className="flex gap-4 text-sm">
                    <span className={cn("text-blue-600", isDayPhase ? "" : "text-blue-300")}>
                      Town: {assignedRoleCount.town}
                    </span>
                    <span className={cn("text-red-600", isDayPhase ? "" : "text-red-300")}>
                      Wolves: {assignedRoleCount.wolf}
                    </span>
                    <span className={cn("text-yellow-600", isDayPhase ? "" : "text-yellow-300")}>
                      Neutral: {assignedRoleCount.neutral}
                    </span>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <Button
                  onClick={assignRoles}
                  className="w-full mb-4"
                  disabled={selectedRoles.length !== players.length}
                >
                  <Shuffle className="w-4 h-4 mr-2" />
                  Assign Roles
                </Button>

                {players.some((p) => p.role) && (
                  <div className="space-y-4">
                    {/* Town */}
                    {players.filter((p) => p.alignment === "town").length > 0 && (
                      <div>
                        <h4 className={cn("font-semibold mb-2 text-blue-600", isDayPhase ? "" : "text-blue-300")}>
                          Town ({assignedRoleCount.town})
                        </h4>
                        <div className="space-y-1">
                          {players
                            .filter((p) => p.alignment === "town")
                            .map((player) => (
                              <div
                                key={player.id}
                                className={cn("p-2 rounded text-sm", isDayPhase ? "bg-blue-50" : "bg-blue-900/20")}
                              >
                                <span className={cn(isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {player.role}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Wolves */}
                    {players.filter((p) => p.alignment === "wolf").length > 0 && (
                      <div>
                        <h4 className={cn("font-semibold mb-2 text-red-600", isDayPhase ? "" : "text-red-300")}>
                          Wolves ({assignedRoleCount.wolf})
                        </h4>
                        <div className="space-y-1">
                          {players
                            .filter((p) => p.alignment === "wolf")
                            .map((player) => (
                              <div
                                key={player.id}
                                className={cn("p-2 rounded text-sm", isDayPhase ? "bg-red-50" : "bg-red-900/20")}
                              >
                                <span className={cn(isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {player.role}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Neutrals */}
                    {players.filter((p) => p.alignment === "neutral").length > 0 && (
                      <div>
                        <h4 className={cn("font-semibold mb-2 text-yellow-600", isDayPhase ? "" : "text-yellow-300")}>
                          Neutrals ({assignedRoleCount.neutral})
                        </h4>
                        <div className="space-y-1">
                          {players
                            .filter((p) => p.alignment === "neutral")
                            .map((player) => (
                              <div
                                key={player.id}
                                className={cn("p-2 rounded text-sm", isDayPhase ? "bg-yellow-50" : "bg-yellow-900/20")}
                              >
                                <span className={cn(isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {player.role}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {(gameData.phase === "night" || gameData.phase === "day") && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Players by Team */}
            <div className="lg:col-span-2 space-y-6">
              {/* Living Players */}
              <div className="space-y-4">
                {/* Town */}
                {players.filter((p) => p.alignment === "town" && p.status === "alive").length > 0 && (
                  <Card className={isDayPhase ? "bg-white/90" : "bg-white/10"}>
                    <CardHeader>
                      <CardTitle className={cn("text-blue-600", isDayPhase ? "" : "text-blue-300")}>
                        Town ({players.filter((p) => p.alignment === "town" && p.status === "alive").length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {players
                        .filter((p) => p.alignment === "town" && p.status === "alive")
                        .map((player) => (
                          <div
                            key={player.id}
                            className={cn(
                              "p-3 rounded border",
                              isDayPhase ? "bg-blue-50 border-blue-200" : "bg-blue-900/20 border-blue-700",
                            )}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {player.role}
                                </span>
                                {player.isFramed && (
                                  <Badge variant="destructive" className="ml-2">
                                    Framed
                                  </Badge>
                                )}
                              </div>
                              <div className="space-x-2">
                                <Button size="sm" variant="outline" onClick={() => toggleFramed(player.id)}>
                                  {player.isFramed ? "Unframe" : "Frame"}
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => togglePlayerStatus(player.id)}>
                                  Kill
                                </Button>
                              </div>
                            </div>
                            <Textarea
                              placeholder="Action notes..."
                              value={player.actionNotes || ""}
                              onChange={(e) => updateActionNotes(player.id, e.target.value)}
                              className="mt-2"
                            />
                          </div>
                        ))}
                    </CardContent>
                  </Card>
                )}

                {/* Wolves */}
                {players.filter((p) => p.alignment === "wolf" && p.status === "alive").length > 0 && (
                  <Card className={isDayPhase ? "bg-white/90" : "bg-white/10"}>
                    <CardHeader>
                      <CardTitle className={cn("text-red-600", isDayPhase ? "" : "text-red-300")}>
                        Wolves ({players.filter((p) => p.alignment === "wolf" && p.status === "alive").length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {players
                        .filter((p) => p.alignment === "wolf" && p.status === "alive")
                        .map((player) => (
                          <div
                            key={player.id}
                            className={cn(
                              "p-3 rounded border",
                              isDayPhase ? "bg-red-50 border-red-200" : "bg-red-900/20 border-red-700",
                            )}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {player.role}
                                </span>
                                {player.isFramed && (
                                  <Badge variant="destructive" className="ml-2">
                                    Framed
                                  </Badge>
                                )}
                              </div>
                              <div className="space-x-2">
                                <Button size="sm" variant="outline" onClick={() => toggleFramed(player.id)}>
                                  {player.isFramed ? "Unframe" : "Frame"}
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => togglePlayerStatus(player.id)}>
                                  Kill
                                </Button>
                              </div>
                            </div>
                            <Textarea
                              placeholder="Action notes..."
                              value={player.actionNotes || ""}
                              onChange={(e) => updateActionNotes(player.id, e.target.value)}
                              className="mt-2"
                            />
                          </div>
                        ))}
                    </CardContent>
                  </Card>
                )}

                {/* Neutrals */}
                {players.filter((p) => p.alignment === "neutral" && p.status === "alive").length > 0 && (
                  <Card className={isDayPhase ? "bg-white/90" : "bg-white/10"}>
                    <CardHeader>
                      <CardTitle className={cn("text-yellow-600", isDayPhase ? "" : "text-yellow-300")}>
                        Neutrals ({players.filter((p) => p.alignment === "neutral" && p.status === "alive").length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {players
                        .filter((p) => p.alignment === "neutral" && p.status === "alive")
                        .map((player) => (
                          <div
                            key={player.id}
                            className={cn(
                              "p-3 rounded border",
                              isDayPhase ? "bg-yellow-50 border-yellow-200" : "bg-yellow-900/20 border-yellow-700",
                            )}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {player.role}
                                </span>
                                {player.isFramed && (
                                  <Badge variant="destructive" className="ml-2">
                                    Framed
                                  </Badge>
                                )}
                              </div>
                              <div className="space-x-2">
                                <Button size="sm" variant="outline" onClick={() => toggleFramed(player.id)}>
                                  {player.isFramed ? "Unframe" : "Frame"}
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => togglePlayerStatus(player.id)}>
                                  Kill
                                </Button>
                              </div>
                            </div>
                            <Textarea
                              placeholder="Action notes..."
                              value={player.actionNotes || ""}
                              onChange={(e) => updateActionNotes(player.id, e.target.value)}
                              className="mt-2"
                            />
                          </div>
                        ))}
                    </CardContent>
                  </Card>
                )}

                {/* Dead Players */}
                {players.filter((p) => p.status === "dead").length > 0 && (
                  <Card className={isDayPhase ? "bg-white/90" : "bg-white/10"}>
                    <CardHeader>
                      <CardTitle className={cn("text-gray-600", isDayPhase ? "" : "text-gray-300")}>
                        Dead ({players.filter((p) => p.status === "dead").length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {players
                        .filter((p) => p.status === "dead")
                        .map((player) => (
                          <div
                            key={player.id}
                            className={cn(
                              "p-2 rounded border flex justify-between items-center",
                              isDayPhase ? "bg-gray-100 border-gray-200" : "bg-gray-800/20 border-gray-600",
                            )}
                          >
                            <span className={cn("text-sm", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                              {player.username} - {player.role}
                            </span>
                            <Button size="sm" variant="outline" onClick={() => togglePlayerStatus(player.id)}>
                              Revive
                            </Button>
                          </div>
                        ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* Voting Booth (Day Phase Only) */}
            {gameData.phase === "day" && (
              <Card className={isDayPhase ? "bg-white/90" : "bg-white/10"}>
                <CardHeader>
                  <CardTitle className={cn(isDayPhase ? "text-gray-900" : "text-white")}>Voting Booth</CardTitle>
                  <p className={cn("text-sm", isDayPhase ? "text-gray-600" : "text-gray-300")}>
                    Votes needed to hang: {gameData.votesToHang}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h4 className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>Vote Count:</h4>
                    {Object.entries(voteCount).map(([target, count]) => (
                      <div
                        key={target}
                        className={cn(
                          "flex justify-between items-center p-2 rounded",
                          count >= gameData.votesToHang
                            ? isDayPhase
                              ? "bg-red-100 border border-red-300"
                              : "bg-red-900/30 border border-red-700"
                            : isDayPhase
                              ? "bg-gray-50"
                              : "bg-white/5",
                        )}
                      >
                        <span className={cn(isDayPhase ? "text-gray-900" : "text-white")}>{target}</span>
                        <Badge variant={count >= gameData.votesToHang ? "destructive" : "secondary"}>
                          {count} votes
                        </Badge>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <h4 className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                      Individual Votes:
                    </h4>
                    {votes.map((vote, index) => (
                      <div key={index} className={cn("text-sm p-2 rounded", isDayPhase ? "bg-gray-50" : "bg-white/5")}>
                        <span className={cn(isDayPhase ? "text-gray-900" : "text-white")}>
                          {vote.voterUsername} → {vote.targetUsername}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
