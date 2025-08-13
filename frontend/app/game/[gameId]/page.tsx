"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, Users, Shuffle, Moon, Sun, Filter, Check, Settings, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { SettingsModal } from "@/components/settings-modal"
import { AddChannelModal } from "@/components/add-channel-modal"
import { ManageChannelsModal } from "@/components/manage-channels-modal"
import { ActionCalculators } from "@/components/action-calculators"

interface Player {
  id: number
  username: string
  status: "alive" | "dead"
  role?: string
  roleId?: number
  skinnedRole?: string
  displayRole?: string
  alignment?: string
  isFramed?: boolean
  isDead?: boolean
  charges?: number
  winByNumber?: number
}

interface Role {
  id: number
  name: string
  alignment: "town" | "wolf" | "neutral"
  description: string
  metadata?: string
  hasInfoFunction?: boolean
  hasCharges?: boolean
  defaultCharges?: number
  hasWinByNumber?: boolean
  defaultWinByNumber?: number
  inWolfChat?: boolean
}

interface GameData {
  id: string
  phase: "signup" | "night" | "day"
  dayNumber: number
  votesToHang: number
  isThemed: boolean
  isSkinned: boolean
  themeName?: string
  serverConfig?: {
    gameCounter: number
    gameName?: string
  }
}

interface GameRole {
  roleId: number
  roleName: string
  roleCount: number
  customName?: string
  charges?: number
  winByNumber?: number
}

interface Vote {
  voterUsername: string
  targetUsername: string
}

export default function GameManagementPage() {
  const params = useParams()
  const gameId = params.gameId as string
  const { toast } = useToast()

  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [gameData, setGameData] = useState<GameData>({
    id: gameId,
    phase: "signup",
    dayNumber: 1,
    votesToHang: 4,
    isThemed: false,
    isSkinned: false,
  })

  const [players, setPlayers] = useState<Player[]>([])
  const [availableRoles, setAvailableRoles] = useState<Role[]>([])

  const [selectedRoles, setSelectedRoles] = useState<Role[]>([])
  const [gameRoles, setGameRoles] = useState<GameRole[]>([])
  const [customRoleNames, setCustomRoleNames] = useState<Record<number, string>>({})
  const [roleCharges, setRoleCharges] = useState<Record<number, number>>({})
  const [roleWinByNumbers, setRoleWinByNumbers] = useState<Record<number, number>>({})
  const [themeInput, setThemeInput] = useState("")
  const [roleSearch, setRoleSearch] = useState("")
  const [alignmentFilter, setAlignmentFilter] = useState<string>("all")
  const [votes, setVotes] = useState<Vote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [gameSettings, setGameSettings] = useState<any>(null);
  const [addChannelModalOpen, setAddChannelModalOpen] = useState(false);
  const [manageChannelsModalOpen, setManageChannelsModalOpen] = useState(false);

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
      let currentGameData = gameData
      if (gameResponse.ok) {
        const game = await gameResponse.json()
        currentGameData = {
          id: game.id,
          phase: game.phase,
          dayNumber: game.dayNumber,
          votesToHang: game.votesToHang,
          isThemed: game.isThemed || false,
          isSkinned: game.isSkinned || false,
          themeName: game.themeName,
          serverConfig: game.serverConfig,
        }
        setGameData(currentGameData)
        setThemeInput(game.themeName || "")
        
        // Load game settings for the modal
        setGameSettings({
          dayMessage: game.dayMessage,
          nightMessage: game.nightMessage,
          wolfDayMessage: game.wolfDayMessage,
          wolfNightMessage: game.wolfNightMessage,
          votesToHang: game.votesToHang
        })
        
        // Load players
        const playersResponse = await fetch(`/api/games/${gameId}/players`)
        if (playersResponse.ok) {
          const playersData = await playersResponse.json()
          setPlayers(playersData)
          

        }
      }

      // Load game roles
      const gameRolesResponse = await fetch(`/api/games/${gameId}/roles`)
      if (gameRolesResponse.ok) {
        const gameRolesData = await gameRolesResponse.json()
        setGameRoles(gameRolesData)
        
        // Build custom role names map
        const customNames: Record<number, string> = {}
        const charges: Record<number, number> = {}
        const winByNumbers: Record<number, number> = {}
        gameRolesData.forEach((gr: any) => {
          if (gr.custom_name) {
            customNames[gr.role_id] = gr.custom_name
          }
          if (gr.charges !== undefined) {
            charges[gr.role_id] = gr.charges
          }
          if (gr.win_by_number !== undefined) {
            winByNumbers[gr.role_id] = gr.win_by_number
          }
        })
        setCustomRoleNames(customNames)
        setRoleCharges(charges)
        setRoleWinByNumbers(winByNumbers)
        
        // Convert game roles to selected roles for display
        const rolesForSelection: Role[] = []
        gameRolesData.forEach((gr: any) => {
          for (let i = 0; i < gr.role_count; i++) {
            rolesForSelection.push({
              id: gr.role_id,
              name: gr.role_name,
              alignment: gr.role_team || gr.team || 'town', // Try both role_team and team
              description: '',
              hasCharges: gr.has_charges || false,
              defaultCharges: gr.default_charges || 0,
              hasWinByNumber: gr.has_win_by_number || false,
              defaultWinByNumber: gr.default_win_by_number || 0,
              inWolfChat: gr.in_wolf_chat || false
            })
          }
        })
        setSelectedRoles(sortRolesByAlignmentAndName(rolesForSelection))
      }

      // Load votes for current day (only during day phase)
      if (currentGameData.phase === "day") {
        const votesResponse = await fetch(`/api/games/${gameId}/votes?dayNumber=${currentGameData.dayNumber}`)
        if (votesResponse.ok) {
          const votesData = await votesResponse.json()
          setVotes(votesData)
        }
      }

      // Load roles
      const rolesResponse = await fetch(`/api/roles`)
      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json()
        const mappedRoles = rolesData.map((role: any) => ({
          ...role,
          alignment: role.alignment || 'town', // The API already returns alignment
          hasCharges: role.hasCharges || false,
          defaultCharges: role.defaultCharges || 0,
          hasWinByNumber: role.hasWinByNumber || false,
          defaultWinByNumber: role.defaultWinByNumber || 0,
          inWolfChat: role.inWolfChat || false
        }))
        setAvailableRoles(mappedRoles)
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
      toast({
        title: "Password Required",
        description: "Please enter a password",
        variant: "destructive",
      })
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
        toast({
          title: "Authentication Failed",
          description: "Incorrect password. Please use the category ID from Discord.",
          variant: "destructive",
        })
      }
    } catch (err) {
      toast({
        title: "Login Error",
        description: "Error verifying password",
        variant: "destructive",
      })
      console.error('Login error:', err)
    } finally {
      setLoginLoading(false)
    }
  }

  const sortRolesByAlignmentAndName = (roles: Role[]): Role[] => {
    return [...roles].sort((a, b) => {
      // Sort by alignment priority: town, wolf, neutral
      const alignmentOrder = { town: 1, wolf: 2, neutral: 3 }
      const aOrder = alignmentOrder[a.alignment] || 4
      const bOrder = alignmentOrder[b.alignment] || 4
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder
      }
      
      // Then sort alphabetically by name within each alignment
      return a.name.localeCompare(b.name)
    })
  }

  const addRoleToGame = (role: Role) => {
    // Always add the role, allowing duplicates
    const newSelectedRoles = [...selectedRoles, role]
    setSelectedRoles(sortRolesByAlignmentAndName(newSelectedRoles))
    
    // Initialize charges if this role has charges and isn't already set
    if (role.hasCharges && roleCharges[role.id] === undefined) {
      setRoleCharges(prev => ({
        ...prev,
        [role.id]: role.defaultCharges || 0
      }))
    }
    
    // Initialize win_by_number if this role has win_by_number and isn't already set
    if (role.hasWinByNumber && roleWinByNumbers[role.id] === undefined) {
      setRoleWinByNumbers(prev => ({
        ...prev,
        [role.id]: role.defaultWinByNumber || 0
      }))
    }
  }

  const removeRoleFromGame = (roleIndex: number) => {
    const newSelectedRoles = selectedRoles.filter((_, index) => index !== roleIndex)
    setSelectedRoles(sortRolesByAlignmentAndName(newSelectedRoles))
  }

  const assignRoles = async () => {
    if (selectedRoles.length !== players.length) {
      toast({
        title: "Role Count Mismatch",
        description: `Need exactly ${players.length} roles for ${players.length} players`,
        variant: "destructive",
      })
      return
    }

    try {
      // First, save the game roles to ensure charges and win_by_number are saved
      const roleCountMap: Record<number, number> = {}
      selectedRoles.forEach(role => {
        roleCountMap[role.id] = (roleCountMap[role.id] || 0) + 1
      })

      const gameRoleData = Object.entries(roleCountMap).map(([roleId, count]) => {
        const roleIdNum = parseInt(roleId)
        const role = availableRoles.find(r => r.id === roleIdNum)
        return {
          roleId: roleIdNum,
          roleCount: count,
          customName: customRoleNames[roleIdNum] || undefined,
          charges: roleCharges[roleIdNum] !== undefined ? roleCharges[roleIdNum] : (role?.hasCharges ? role.defaultCharges : undefined),
          winByNumber: roleWinByNumbers[roleIdNum] !== undefined ? roleWinByNumbers[roleIdNum] : (role?.hasWinByNumber ? role.defaultWinByNumber : undefined)
        }
      })

      // Save game roles first
      const saveRolesResponse = await fetch(`/api/games/${gameId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameRoles: gameRoleData })
      })

      if (!saveRolesResponse.ok) {
        toast({
          title: "Save Failed",
          description: "Failed to save role configuration before assignment",
          variant: "destructive",
        })
        return
      }

      // Now assign roles to players
      const shuffledPlayers = [...players].sort(() => Math.random() - 0.5)
      const shuffledRoles = [...selectedRoles].sort(() => Math.random() - 0.5)

      const assignments = shuffledPlayers.map((player, index) => ({
        playerId: player.id,
        roleId: shuffledRoles[index].id,
        isWolf: shuffledRoles[index].alignment === "wolf",
        skinnedRole: gameData.isSkinned ? shuffledRoles[index].name : undefined
      }))

      const response = await fetch(`/api/games/${gameId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assignRoles',
          data: { assignments }
        })
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Roles assigned successfully with charges and win conditions!",
        })
        
        // Reload players to get updated data
        const playersResponse = await fetch(`/api/games/${gameId}/players`)
        if (playersResponse.ok) {
          const playersData = await playersResponse.json()
          setPlayers(playersData)
        }
      } else {
        toast({
          title: "Assignment Failed",
          description: "Failed to assign roles",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error assigning roles:', error)
      toast({
        title: "Assignment Error",
        description: "Error assigning roles",
        variant: "destructive",
      })
    }
  }

  // Helper function to count couple roles in selected roles
  const getCoupleCount = (): number => {
    return selectedRoles.filter(role => role.name === "Couple").length
  }

  // Helper function to get couple validation message
  const getCoupleValidationMessage = (): string | null => {
    const coupleCount = getCoupleCount()
    if (coupleCount === 1) {
      return "There is only one couple in the role list"
    } else if (coupleCount > 2) {
      return "There are more than two couples, manually create the couple chats with the 'Add Channel' button"
    }
    return null
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
        toast({
          title: "Update Failed",
          description: "Failed to update player status",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error updating player status:', error)
      toast({
        title: "Update Error",
        description: "Error updating player status",
        variant: "destructive",
      })
    }
  }

  const updatePlayerCharges = async (playerId: number, charges: number) => {
    try {
      const response = await fetch(`/api/games/${gameId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updatePlayer', 
          data: { playerId, charges }
        })
      })

      if (response.ok) {
        setPlayers(
          players.map((player) =>
            player.id === playerId ? { ...player, charges } : player,
          ),
        )
      } else {
        toast({
          title: "Update Failed",
          description: "Failed to update player charges",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error updating player charges:', error)
      toast({
        title: "Update Error",
        description: "Error updating player charges",
        variant: "destructive",
      })
    }
  }

  const updatePlayerWinByNumber = async (playerId: number, winByNumber: number) => {
    try {
      const response = await fetch(`/api/games/${gameId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updatePlayer', 
          data: { playerId, winByNumber }
        })
      })

      if (response.ok) {
        setPlayers(
          players.map((player) =>
            player.id === playerId ? { ...player, winByNumber } : player,
          ),
        )
      } else {
        toast({
          title: "Update Failed",
          description: "Failed to update player win by number",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error updating player win by number:', error)
      toast({
        title: "Update Error",
        description: "Error updating player win by number",
        variant: "destructive",
      })
    }
  }

  const saveGameRoles = async () => {
    if (selectedRoles.length === 0) {
      toast({
        title: "No Roles Selected",
        description: "Please select some roles first",
        variant: "destructive",
      })
      return
    }

    // Convert selected roles to game roles format
    const roleCountMap: Record<number, number> = {}
    selectedRoles.forEach(role => {
      roleCountMap[role.id] = (roleCountMap[role.id] || 0) + 1
    })

    const gameRoleData = Object.entries(roleCountMap).map(([roleId, count]) => {
      const roleIdNum = parseInt(roleId)
      const role = availableRoles.find(r => r.id === roleIdNum)
      return {
        roleId: roleIdNum,
        roleCount: count,
        customName: customRoleNames[roleIdNum] || undefined,
        charges: roleCharges[roleIdNum] !== undefined ? roleCharges[roleIdNum] : (role?.hasCharges ? role.defaultCharges : undefined),
        winByNumber: roleWinByNumbers[roleIdNum] !== undefined ? roleWinByNumbers[roleIdNum] : (role?.hasWinByNumber ? role.defaultWinByNumber : undefined)
      }
    })

    try {
      const response = await fetch(`/api/games/${gameId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameRoles: gameRoleData })
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Role configuration saved successfully!",
        })
        // Don't reload all data - just update the game roles state
        const gameRolesResponse = await fetch(`/api/games/${gameId}/roles`)
        if (gameRolesResponse.ok) {
          const gameRolesData = await gameRolesResponse.json()
          setGameRoles(gameRolesData)
        }
      } else {
        toast({
          title: "Save Failed",
          description: "Failed to save game roles",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error saving game roles:', error)
      toast({
        title: "Save Error",
        description: "Error saving game roles",
        variant: "destructive",
      })
    }
  }

  const saveThemeSettings = async () => {
    if (gameData.isThemed && !themeInput.trim()) {
      toast({
        title: "Theme Name Required",
        description: "Please enter a theme name",
        variant: "destructive",
      })
      return
    }

    try {
      const response = await fetch(`/api/games/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateTheme',
          isThemed: gameData.isThemed,
          isSkinned: gameData.isSkinned,
          themeName: gameData.isThemed ? themeInput.trim() : null
        })
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Theme settings saved successfully!",
        })
        setGameData(prev => ({
          ...prev,
          themeName: gameData.isThemed ? themeInput.trim() : undefined
        }))
      } else {
        toast({
          title: "Save Failed",
          description: "Failed to save theme settings",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error saving theme settings:', error)
      toast({
        title: "Save Error",
        description: "Error saving theme settings",
        variant: "destructive",
      })
    }
  }

  const resetThemeSettings = async () => {
    try {
      const response = await fetch(`/api/games/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateTheme',
          isThemed: false,
          isSkinned: false,
          themeName: null
        })
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Theme settings reset successfully!",
        })
        setGameData(prev => ({
          ...prev,
          isThemed: false,
          isSkinned: false,
          themeName: undefined
        }))
        setThemeInput("")
        setCustomRoleNames({})
      } else {
        toast({
          title: "Reset Failed",
          description: "Failed to reset theme settings",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error resetting theme settings:', error)
      toast({
        title: "Reset Error",
        description: "Error resetting theme settings",
        variant: "destructive",
      })
    }
  }

  const toggleThemed = (enabled: boolean) => {
    setGameData(prev => ({
      ...prev,
      isThemed: enabled,
      isSkinned: enabled ? prev.isSkinned : false
    }))
  }

  const toggleSkinned = (enabled: boolean) => {
    setGameData(prev => ({
      ...prev,
      isSkinned: enabled
    }))
  }

  const getDisplayRoleName = (player: Player): string => {
    if (gameData.isSkinned && player.skinnedRole) {
      return player.skinnedRole
    }
    
    if (gameData.isThemed && player.roleId && customRoleNames[player.roleId]) {
      const actualRoleName = player.role || 'Unknown'
      return `${customRoleNames[player.roleId]} (${actualRoleName})`
    }
    
    return player.role || 'Unknown'
  }

  const updateCustomRoleName = (roleId: number, customName: string) => {
    setCustomRoleNames(prev => ({
      ...prev,
      [roleId]: customName
    }))
  }

  const updateRoleCharges = (roleId: number, charges: number) => {
    setRoleCharges(prev => ({
      ...prev,
      [roleId]: charges
    }))
  }

  const updateRoleWinByNumber = (roleId: number, winByNumber: number) => {
    setRoleWinByNumbers(prev => ({
      ...prev,
      [roleId]: winByNumber
    }))
  }

  const roleHasCharges = (player: Player): boolean => {
    if (!player.roleId) return false
    const role = availableRoles.find(r => r.id === player.roleId)
    return role?.hasCharges || false
  }

  const roleHasWinByNumber = (player: Player): boolean => {
    if (!player.roleId) return false
    const role = availableRoles.find(r => r.id === player.roleId)
    return role?.hasWinByNumber || false
  }

  const filteredRoles = availableRoles
    .filter((role) => role.name.toLowerCase().includes(roleSearch.toLowerCase()))
    .filter((role) => alignmentFilter === "all" || role.alignment === alignmentFilter)
    .sort((a, b) => {
      // Sort by alignment priority: town, wolf, neutral
      const alignmentOrder = { town: 1, wolf: 2, neutral: 3 }
      const aOrder = alignmentOrder[a.alignment] || 4
      const bOrder = alignmentOrder[b.alignment] || 4
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder
      }
      
      // Then sort alphabetically by name within each alignment
      return a.name.localeCompare(b.name)
    })

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
            <h1 className="text-3xl font-bold">
              {/*When starting a game the game counter gets incremented by 1, so we need to subtract 1 to get the correct game number*/}
              {gameData.serverConfig?.gameName} Game {gameData.serverConfig?.gameCounter ? gameData.serverConfig.gameCounter - 1 : gameId}
            </h1>
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
          
          <div className="flex items-center gap-2">
            {gameData.phase === "signup" && (
              <>
                <Button
                  onClick={() => setAddChannelModalOpen(true)}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex items-center gap-2",
                    isDayPhase ? "bg-white/90" : "bg-white/10"
                  )}
                >
                  <Plus className="w-4 h-4" />
                  Add Channel
                </Button>
                
                <Button
                  onClick={() => setManageChannelsModalOpen(true)}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex items-center gap-2",
                    isDayPhase ? "bg-white/90" : "bg-white/10"
                  )}
                >
                  <Users className="w-4 h-4" />
                  Manage Channels
                </Button>
              </>
            )}
            
            <Button
              onClick={() => setSettingsModalOpen(true)}
              variant="outline"
              size="sm"
              className={cn(
                "flex items-center gap-2",
                isDayPhase ? "bg-white/90" : "bg-white/10"
              )}
            >
              <Settings className="w-4 h-4" />
              Settings
            </Button>
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
                
                {/* Theme Settings */}
                <div className="space-y-4 pt-4 border-t border-white/20">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="themed"
                        checked={gameData.isThemed}
                        onCheckedChange={toggleThemed}
                      />
                      <label htmlFor="themed" className={cn("text-sm font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                        Themed
                      </label>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="skinned"
                        checked={gameData.isSkinned}
                        disabled={!gameData.isThemed}
                        onCheckedChange={toggleSkinned}
                      />
                      <label htmlFor="skinned" className={cn("text-sm font-medium", isDayPhase ? "text-gray-900" : "text-white", !gameData.isThemed && "opacity-50")}>
                        Skinned
                      </label>
                    </div>
                  </div>
                  
                  {gameData.isThemed && (
                    <div className="space-y-2">
                      <Input
                        placeholder="Enter theme name..."
                        value={themeInput}
                        onChange={(e) => setThemeInput(e.target.value)}
                        className="text-sm"
                      />
                      <div className="flex gap-2">
                        <Button 
                          onClick={saveThemeSettings}
                          size="sm" 
                          disabled={!themeInput.trim()}
                          className="flex-1"
                        >
                          Save Theme Settings
                        </Button>
                        <Button 
                          onClick={resetThemeSettings}
                          size="sm" 
                          variant="destructive"
                          className="flex-1"
                        >
                          Reset Theme Settings
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                
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

                {/* Alignment Filter */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-gray-400" />
                    <span className={cn("text-sm font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                      Filter by alignment:
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant={alignmentFilter === "all" ? "default" : "outline"}
                      onClick={() => setAlignmentFilter("all")}
                      className="text-xs"
                    >
                      All
                    </Button>
                    <Button
                      size="sm"
                      variant={alignmentFilter === "town" ? "default" : "outline"}
                      onClick={() => setAlignmentFilter("town")}
                      className="text-xs"
                    >
                      Town
                    </Button>
                    <Button
                      size="sm"
                      variant={alignmentFilter === "wolf" ? "destructive" : "outline"}
                      onClick={() => setAlignmentFilter("wolf")}
                      className="text-xs"
                    >
                      Wolf
                    </Button>
                    <Button
                      size="sm"
                      variant={alignmentFilter === "neutral" ? "secondary" : "outline"}
                      onClick={() => setAlignmentFilter("neutral")}
                      className="text-xs"
                    >
                      Neutral
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {alignmentFilter === "all" ? (
                    // Group by alignment when showing all
                    ["town", "wolf", "neutral"].map((alignment) => {
                      const rolesInAlignment = filteredRoles.filter(role => role.alignment === alignment)
                      if (rolesInAlignment.length === 0) return null
                      
                      return (
                        <div key={alignment} className="space-y-2">
                          <div className={cn("text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded", 
                            alignment === "town" ? "text-blue-600 bg-blue-100/50" :
                            alignment === "wolf" ? "text-red-600 bg-red-100/50" :
                            "text-yellow-600 bg-yellow-100/50",
                            !isDayPhase && (
                              alignment === "town" ? "text-blue-300 bg-blue-900/20" :
                              alignment === "wolf" ? "text-red-300 bg-red-900/20" :
                              "text-yellow-300 bg-yellow-900/20"
                            )
                          )}>
                            {alignment} ({rolesInAlignment.length})
                          </div>
                          {rolesInAlignment.map((role) => {
                            const selectedCount = selectedRoles.filter(r => r.id === role.id).length
                            return (
                              <div
                                key={role.id}
                                className={cn(
                                  "p-2 rounded border cursor-pointer hover:bg-opacity-80 transition-colors ml-4",
                                  isDayPhase
                                    ? "bg-white border-gray-200 hover:bg-gray-50"
                                    : "bg-white/5 border-white/20 hover:bg-white/10",
                                  selectedCount > 0 && (isDayPhase ? "ring-2 ring-blue-200" : "ring-2 ring-blue-500/30")
                                )}
                                onClick={() => addRoleToGame(role)}
                              >
                                <div className="flex justify-between items-center">
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
                            )
                          })}
                        </div>
                      )
                    })
                  ) : (
                    // Show flat list when filtering by specific alignment
                    filteredRoles.map((role) => {
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
                          <div className="flex justify-between items-center">
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
                          {!role.inWolfChat && role.alignment === "wolf" && (
                            <p className={cn("text-xs italic mt-1", isDayPhase ? "text-orange-600" : "text-orange-300")}>
                              * Not added to wolf chat
                            </p>
                          )}
                        </div>
                      )
                    })
                  )}
                  {filteredRoles.length === 0 && (
                    <p className={cn("text-center py-4 text-sm", isDayPhase ? "text-gray-500" : "text-gray-300")}>
                      No roles found matching your search criteria.
                    </p>
                  )}
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
                        "p-2 rounded border",
                        isDayPhase ? "bg-green-50 border-green-200" : "bg-green-900/20 border-green-700",
                      )}
                    >
                      <div className="flex justify-between items-center">
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
                      {/* Charge counter for roles with charges */}
                      {role.hasCharges && (
                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                          <div className="flex items-center justify-between">
                            <span className={cn("text-xs font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                              Charges: {roleCharges[role.id] || role.defaultCharges || 0}
                            </span>
                            <div className="flex items-center gap-1">
                              <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => updateRoleCharges(role.id, (roleCharges[role.id] || role.defaultCharges || 0) + 1)}
                                className="px-2 py-1 h-5 text-xs"
                                disabled={(roleCharges[role.id] || role.defaultCharges || 0) >= 10}
                              >
                                +
                              </Button>
                              <Button 
                                size="sm" 
                                variant="destructive" 
                                onClick={() => updateRoleCharges(role.id, Math.max(0, (roleCharges[role.id] || role.defaultCharges || 0) - 1))}
                                className="px-2 py-1 h-5 text-xs"
                                disabled={(roleCharges[role.id] || role.defaultCharges || 0) <= 0}
                              >
                                -
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Win by number counter for roles with win_by_number */}
                      {role.hasWinByNumber && (
                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                          <div className="flex items-center justify-between">
                            <span className={cn("text-xs font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                              Win by number: {roleWinByNumbers[role.id] || role.defaultWinByNumber || 0}
                            </span>
                            <div className="flex items-center gap-1">
                              <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => updateRoleWinByNumber(role.id, (roleWinByNumbers[role.id] || role.defaultWinByNumber || 0) + 1)}
                                className="px-2 py-1 h-5 text-xs"
                                disabled={(roleWinByNumbers[role.id] || role.defaultWinByNumber || 0) >= 20}
                              >
                                +
                              </Button>
                              <Button 
                                size="sm" 
                                variant="destructive" 
                                onClick={() => updateRoleWinByNumber(role.id, Math.max(0, (roleWinByNumbers[role.id] || role.defaultWinByNumber || 0) - 1))}
                                className="px-2 py-1 h-5 text-xs"
                                disabled={(roleWinByNumbers[role.id] || role.defaultWinByNumber || 0) <= 0}
                              >
                                -
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                    </div>
                  ))}
                  {selectedRoles.length === 0 && (
                    <p className={cn("text-center py-4", isDayPhase ? "text-gray-500" : "text-gray-300")}>
                      No roles selected. Click on roles above to add them.
                    </p>
                  )}
                </div>
                
                {/* Custom Role Names (when themed) */}
                {gameData.isThemed && selectedRoles.length > 0 && (
                  <div className="pt-4 border-t border-white/20">
                    <h4 className={cn("font-medium mb-3 text-sm", isDayPhase ? "text-gray-900" : "text-white")}>
                      Custom Role Names
                    </h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {Object.entries(
                        selectedRoles.reduce((acc, role) => {
                          if (!acc[role.id]) {
                            acc[role.id] = { role, count: 0 }
                          }
                          acc[role.id].count++
                          return acc
                        }, {} as Record<number, { role: Role; count: number }>)
                      ).map(([roleId, { role, count }]) => (
                        <div key={roleId} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-xs font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                              {role.name} {count > 1 && `(x${count})`}
                            </span>
                          </div>
                          <Input
                            placeholder={`Custom name for ${role.name}...`}
                            value={customRoleNames[parseInt(roleId)] || ""}
                            onChange={(e) => updateCustomRoleName(parseInt(roleId), e.target.value)}
                            className="text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Save Game Roles Button */}
                <div className="pt-4 border-t border-white/20">
                  <Button 
                    onClick={saveGameRoles}
                    className="w-full"
                    disabled={selectedRoles.length === 0}
                  >
                    Save Role Configuration
                  </Button>
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

                {/* Couple validation message */}
                {getCoupleValidationMessage() && (
                  <div className={cn(
                    "p-3 rounded-md text-sm mb-4",
                    isDayPhase ? "bg-orange-50 text-orange-700 border border-orange-200" : "bg-orange-900/20 text-orange-300 border border-orange-700"
                  )}>
                    {getCoupleValidationMessage()}
                  </div>
                )}

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
                                  {player.username} - {getDisplayRoleName(player)}
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
                                  {player.username} - {getDisplayRoleName(player)}
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
                                  {player.username} - {getDisplayRoleName(player)}
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
          <div className="space-y-6">
            {/* Action Calculators - Only show during night phase */}
            <ActionCalculators 
              players={players}
              gameRoles={availableRoles}
              isDayPhase={isDayPhase}
            />
            
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
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-2 flex-1">
                                <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {getDisplayRoleName(player)}
                                </span>
                              </div>
                              <div className="space-x-2">
                                <Button size="sm" variant="destructive" onClick={() => togglePlayerStatus(player.id)}>
                                  Kill
                                </Button>
                              </div>
                            </div>
                            
                            {/* Charges for roles that have them */}
                            {roleHasCharges(player) && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className={cn("text-sm font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                                  Charges:
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerCharges(player.id, Math.max(0, (player.charges || 0) - 1))}
                                    disabled={(player.charges || 0) <= 0}
                                    className="px-2 py-1 h-6"
                                  >
                                    -
                                  </Button>
                                  <span className={cn("px-2 text-sm font-mono", isDayPhase ? "text-gray-900" : "text-white")}>
                                    {player.charges || 0}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerCharges(player.id, (player.charges || 0) + 1)}
                                    className="px-2 py-1 h-6"
                                  >
                                    +
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Win by number for roles that have them */}
                            {roleHasWinByNumber(player) && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className={cn("text-sm font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                                  Win by number:
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerWinByNumber(player.id, Math.max(0, (player.winByNumber || 0) - 1))}
                                    disabled={(player.winByNumber || 0) <= 0}
                                    className="px-2 py-1 h-6"
                                  >
                                    -
                                  </Button>
                                  <span className={cn("px-2 text-sm font-mono", isDayPhase ? "text-gray-900" : "text-white")}>
                                    {player.winByNumber || 0}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerWinByNumber(player.id, (player.winByNumber || 0) + 1)}
                                    className="px-2 py-1 h-6"
                                  >
                                    +
                                  </Button>
                                </div>
                              </div>
                            )}
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
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-2 flex-1">
                                <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {getDisplayRoleName(player)}
                                </span>
                              </div>
                              <div className="space-x-2">
                                <Button size="sm" variant="destructive" onClick={() => togglePlayerStatus(player.id)}>
                                  Kill
                                </Button>
                              </div>
                            </div>
                            
                            {/* Charges for roles that have them */}
                            {roleHasCharges(player) && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className={cn("text-sm font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                                  Charges:
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerCharges(player.id, Math.max(0, (player.charges || 0) - 1))}
                                    disabled={(player.charges || 0) <= 0}
                                    className="px-2 py-1 h-6"
                                  >
                                    -
                                  </Button>
                                  <span className={cn("px-2 text-sm font-mono", isDayPhase ? "text-gray-900" : "text-white")}>
                                    {player.charges || 0}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerCharges(player.id, (player.charges || 0) + 1)}
                                    className="px-2 py-1 h-6"
                                  >
                                    +
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Win by number for roles that have them */}
                            {roleHasWinByNumber(player) && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className={cn("text-sm font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                                  Win by number:
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerWinByNumber(player.id, Math.max(0, (player.winByNumber || 0) - 1))}
                                    disabled={(player.winByNumber || 0) <= 0}
                                    className="px-2 py-1 h-6"
                                  >
                                    -
                                  </Button>
                                  <span className={cn("px-2 text-sm font-mono", isDayPhase ? "text-gray-900" : "text-white")}>
                                    {player.winByNumber || 0}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerWinByNumber(player.id, (player.winByNumber || 0) + 1)}
                                    className="px-2 py-1 h-6"
                                  >
                                    +
                                  </Button>
                                </div>
                              </div>
                            )}
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
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-2 flex-1">
                                <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                  {player.username} - {getDisplayRoleName(player)}
                                </span>
                              </div>
                              <div className="space-x-2">
                                <Button size="sm" variant="destructive" onClick={() => togglePlayerStatus(player.id)}>
                                  Kill
                                </Button>
                              </div>
                            </div>
                            
                            {/* Charges for roles that have them */}
                            {roleHasCharges(player) && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className={cn("text-sm font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                                  Charges:
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerCharges(player.id, Math.max(0, (player.charges || 0) - 1))}
                                    disabled={(player.charges || 0) <= 0}
                                    className="px-2 py-1 h-6"
                                  >
                                    -
                                  </Button>
                                  <span className={cn("px-2 text-sm font-mono", isDayPhase ? "text-gray-900" : "text-white")}>
                                    {player.charges || 0}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerCharges(player.id, (player.charges || 0) + 1)}
                                    className="px-2 py-1 h-6"
                                  >
                                    +
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Win by number for roles that have them */}
                            {roleHasWinByNumber(player) && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className={cn("text-sm font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                                  Win by number:
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerWinByNumber(player.id, Math.max(0, (player.winByNumber || 0) - 1))}
                                    disabled={(player.winByNumber || 0) <= 0}
                                    className="px-2 py-1 h-6"
                                  >
                                    -
                                  </Button>
                                  <span className={cn("px-2 text-sm font-mono", isDayPhase ? "text-gray-900" : "text-white")}>
                                    {player.winByNumber || 0}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updatePlayerWinByNumber(player.id, (player.winByNumber || 0) + 1)}
                                    className="px-2 py-1 h-6"
                                  >
                                    +
                                  </Button>
                                </div>
                              </div>
                            )}
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
                              {player.username} - {getDisplayRoleName(player)}
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
          </div>
        )}
      </div>
      
      {/* Settings Modal */}
      <SettingsModal
        gameId={gameId}
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        initialSettings={gameSettings}
      />
      
      {/* Add Channel Modal */}
      <AddChannelModal
        gameId={gameId}
        isOpen={addChannelModalOpen}
        onClose={() => setAddChannelModalOpen(false)}
        onChannelAdded={() => {
          // Refresh the settings modal if it's open to show the new channel
          if (settingsModalOpen) {
            // This will trigger a reload of channels in the settings modal
            setSettingsModalOpen(false)
            setTimeout(() => setSettingsModalOpen(true), 100)
          }
        }}
      />
      
      {/* Manage Channels Modal */}
      <ManageChannelsModal
        gameId={gameId}
        isOpen={manageChannelsModalOpen}
        onClose={() => setManageChannelsModalOpen(false)}
      />
    </div>
  )
}
