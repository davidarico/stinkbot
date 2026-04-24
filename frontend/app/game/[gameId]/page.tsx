"use client"

import { useState, useEffect } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, Users, Shuffle, Moon, Sun, Filter, Check, Settings, Plus, ClipboardList, Server } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { SettingsModal } from "@/components/settings-modal"
import { AddChannelModal } from "@/components/add-channel-modal"
import { ManageChannelsModal } from "@/components/manage-channels-modal"
import { ActionCalculators } from "@/components/action-calculators"
import { BreakdownBuilderModal } from "@/components/breakdown-builder-modal"
import { ServerRolesModal } from "@/components/server-roles-modal"

interface Player {
  id: number
  username: string
  status: "alive" | "dead"
  role?: string
  roleId?: number
  skinnedRole?: string
  thematicCustomName?: string | null
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

interface SelectedRoleSlot {
  role: Role
  customName: string
  charges?: number
  winByNumber?: number
}

interface GameData {
  id: string
  phase: "signup" | "night" | "day"
  dayNumber: number
  votesToHang: number
  isThemed: boolean
  isSkinned: boolean
  themeName?: string
  serverId?: string
  serverConfig?: {
    gameCounter: number
    gameName?: string
  }
}

interface GameRole {
  roleId: number
  roleName: string
  sortIndex: number
  customName?: string
  charges?: number
  winByNumber?: number
}

interface Vote {
  voterUsername: string
  targetUsername: string
}

/** Uniform random permutation (Fisher–Yates). Does not mutate the input. */
function shuffleArray<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function sortSlotsByAlignmentAndName(slots: SelectedRoleSlot[]): SelectedRoleSlot[] {
  return [...slots].sort((a, b) => {
    const alignmentOrder = { town: 1, wolf: 2, neutral: 3 }
    const aOrder = alignmentOrder[a.role.alignment] || 4
    const bOrder = alignmentOrder[b.role.alignment] || 4
    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }
    return a.role.name.localeCompare(b.role.name)
  })
}

export default function GameManagementPage() {
  const params = useParams()
  const opts = useSearchParams()
  const gameId = params.gameId as string
  const { toast } = useToast()

  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState(opts?.get("p") ?? "")

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

  const [selectedRoleSlots, setSelectedRoleSlots] = useState<SelectedRoleSlot[]>([])
  const [gameRoles, setGameRoles] = useState<GameRole[]>([])
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
  const [breakdownBuilderModalOpen, setBreakdownBuilderModalOpen] = useState(false);
  const [serverRolesModalOpen, setServerRolesModalOpen] = useState(false);

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
          serverId: game.serverId,
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

      // Load game roles (one API row per seat / sort_index)
      const gameRolesResponse = await fetch(`/api/games/${gameId}/roles`)
      if (gameRolesResponse.ok) {
        const gameRolesData = await gameRolesResponse.json()
        const rows = [...gameRolesData].sort((a: any, b: any) => (a.sort_index ?? 0) - (b.sort_index ?? 0))
        setGameRoles(
          rows.map((gr: any) => ({
            roleId: gr.role_id,
            roleName: gr.role_name,
            sortIndex: gr.sort_index,
            customName: gr.custom_name || undefined,
            charges: gr.charges,
            winByNumber: gr.win_by_number,
          })),
        )

        const slots: SelectedRoleSlot[] = rows.map((gr: any) => ({
          role: {
            id: gr.role_id,
            name: gr.role_name,
            alignment: gr.role_team || gr.team || "town",
            description: "",
            hasCharges: gr.has_charges || false,
            defaultCharges: gr.default_charges || 0,
            hasWinByNumber: gr.has_win_by_number || false,
            defaultWinByNumber: gr.default_win_by_number || 0,
            inWolfChat: gr.in_wolf_chat || false,
          },
          customName: gr.custom_name || "",
          charges: gr.charges !== undefined ? gr.charges : undefined,
          winByNumber: gr.win_by_number !== undefined ? gr.win_by_number : undefined,
        }))
        setSelectedRoleSlots(sortSlotsByAlignmentAndName(slots))
      }

      // Load votes for current day (only during day phase)
      if (currentGameData.phase === "day") {
        const votesResponse = await fetch(`/api/games/${gameId}/votes?dayNumber=${currentGameData.dayNumber}`)
        if (votesResponse.ok) {
          const votesData = await votesResponse.json()
          setVotes(votesData)
        }
      }

      // Load roles (general roles + server-specific roles)
      const serverId = currentGameData.serverId
      const rolesUrl = serverId ? `/api/roles?server_id=${serverId}` : `/api/roles`
      const rolesResponse = await fetch(rolesUrl)
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
    if (!password?.trim()) {
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

  const addRoleToGame = (role: Role) => {
    const existingForRole = selectedRoleSlots.filter((s) => s.role.id === role.id)
    const inheritedCharges =
      existingForRole[0]?.charges !== undefined
        ? existingForRole[0].charges
        : role.hasCharges
          ? role.defaultCharges || 0
          : undefined
    const inheritedWin =
      existingForRole[0]?.winByNumber !== undefined
        ? existingForRole[0].winByNumber
        : role.hasWinByNumber
          ? role.defaultWinByNumber || 0
          : undefined

    const slot: SelectedRoleSlot = {
      role,
      customName: "",
      charges: role.hasCharges ? inheritedCharges : undefined,
      winByNumber: role.hasWinByNumber ? inheritedWin : undefined,
    }
    setSelectedRoleSlots((prev) => sortSlotsByAlignmentAndName([...prev, slot]))
  }

  const removeRoleFromGame = (slotIndex: number) => {
    setSelectedRoleSlots((prev) =>
      sortSlotsByAlignmentAndName(prev.filter((_, index) => index !== slotIndex)),
    )
  }

  const buildGameRolePayloadFromOrderedSlots = (orderedSlots: SelectedRoleSlot[]) => {
    return orderedSlots.map((slot, sortIndex) => {
      const charges =
        slot.charges !== undefined
          ? slot.charges
          : slot.role.hasCharges
            ? slot.role.defaultCharges || 0
            : 0
      const winByNumber =
        slot.winByNumber !== undefined
          ? slot.winByNumber
          : slot.role.hasWinByNumber
            ? slot.role.defaultWinByNumber || 0
            : 0
      return {
        sortIndex,
        roleId: slot.role.id,
        customName: slot.customName.trim() || undefined,
        charges,
        winByNumber,
      }
    })
  }

  const assignRoles = async () => {
    if (selectedRoleSlots.length !== players.length) {
      toast({
        title: "Role Count Mismatch",
        description: `Need exactly ${players.length} roles for ${players.length} players`,
        variant: "destructive",
      })
      return
    }

    try {
      const orderedSlots = sortSlotsByAlignmentAndName([...selectedRoleSlots])
      const gameRoleData = buildGameRolePayloadFromOrderedSlots(orderedSlots)

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

      const slotsWithSortIndex = orderedSlots.map((slot, sortIndex) => ({ ...slot, sortIndex }))
      const shuffledPlayers = shuffleArray(players)
      const shuffledSlots = shuffleArray(slotsWithSortIndex)

      const assignments = shuffledPlayers.map((player, index) => ({
        playerId: player.id,
        roleId: shuffledSlots[index].role.id,
        isWolf: shuffledSlots[index].role.alignment === "wolf",
        skinnedRole: gameData.isSkinned ? shuffledSlots[index].role.name : undefined,
        thematicCustomName: gameData.isThemed
          ? shuffledSlots[index].customName.trim() || null
          : null,
        gameRoleSortIndex: shuffledSlots[index].sortIndex,
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
    return selectedRoleSlots.filter((s) => s.role.name === "Couple").length
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

  /** Persists theme flags + name to the server. Used when saving role configuration. */
  const persistThemeSettings = async (): Promise<boolean> => {
    if (gameData.isThemed && !themeInput.trim()) {
      toast({
        title: "Theme Name Required",
        description: "Please enter a theme name",
        variant: "destructive",
      })
      return false
    }

    try {
      const response = await fetch(`/api/games/${gameId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateTheme",
          isThemed: gameData.isThemed,
          isSkinned: gameData.isSkinned,
          themeName: gameData.isThemed ? themeInput.trim() : null,
        }),
      })

      if (response.ok) {
        setGameData((prev) => ({
          ...prev,
          themeName: gameData.isThemed ? themeInput.trim() : undefined,
        }))
        return true
      }
      toast({
        title: "Save Failed",
        description: "Failed to save theme settings",
        variant: "destructive",
      })
      return false
    } catch (error) {
      console.error("Error saving theme settings:", error)
      toast({
        title: "Save Error",
        description: "Error saving theme settings",
        variant: "destructive",
      })
      return false
    }
  }

  const saveGameRoles = async () => {
    if (selectedRoleSlots.length === 0) {
      toast({
        title: "No Roles Selected",
        description: "Please select some roles first",
        variant: "destructive",
      })
      return
    }

    const themeOk = await persistThemeSettings()
    if (!themeOk) return

    const orderedSlots = sortSlotsByAlignmentAndName([...selectedRoleSlots])
    const gameRoleData = buildGameRolePayloadFromOrderedSlots(orderedSlots)

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
        const gameRolesResponse = await fetch(`/api/games/${gameId}/roles`)
        if (gameRolesResponse.ok) {
          const gameRolesData = await gameRolesResponse.json()
          const rows = [...gameRolesData].sort((a: any, b: any) => (a.sort_index ?? 0) - (b.sort_index ?? 0))
          setGameRoles(
            rows.map((gr: any) => ({
              roleId: gr.role_id,
              roleName: gr.role_name,
              sortIndex: gr.sort_index,
              customName: gr.custom_name || undefined,
              charges: gr.charges,
              winByNumber: gr.win_by_number,
            })),
          )
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
        setSelectedRoleSlots((prev) => prev.map((s) => ({ ...s, customName: "" })))
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

    const flavor = player.thematicCustomName?.trim()
    if (gameData.isThemed && flavor) {
      const actualRoleName = player.role || "Unknown"
      return `${flavor} (${actualRoleName})`
    }

    return player.role || "Unknown"
  }

  const updateSlotCustomName = (slotIndex: number, customName: string) => {
    setSelectedRoleSlots((prev) =>
      prev.map((slot, i) => (i === slotIndex ? { ...slot, customName } : slot)),
    )
  }

  const updateRoleCharges = (roleId: number, charges: number) => {
    setSelectedRoleSlots((prev) =>
      prev.map((slot) => (slot.role.id === roleId ? { ...slot, charges } : slot)),
    )
  }

  const updateRoleWinByNumber = (roleId: number, winByNumber: number) => {
    setSelectedRoleSlots((prev) =>
      prev.map((slot) => (slot.role.id === roleId ? { ...slot, winByNumber } : slot)),
    )
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
    town: selectedRoleSlots.filter((s) => s.role.alignment === "town").length,
    wolf: selectedRoleSlots.filter((s) => s.role.alignment === "wolf").length,
    neutral: selectedRoleSlots.filter((s) => s.role.alignment === "neutral").length,
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

  // Night / signup UI uses dark surfaces; shadcn `foreground` only flips with `.dark`.
  // Toggle on <html> so portaled dialogs pick up the same tokens as the page.
  useEffect(() => {
    const root = document.documentElement
    if (!isAuthenticated || loading || error) {
      root.classList.remove("dark")
      return
    }
    root.classList.toggle("dark", !isDayPhase)
    return () => {
      root.classList.remove("dark")
    }
  }, [isAuthenticated, loading, error, isDayPhase])

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
            <div className="flex items-center gap-2 mt-2 flex-wrap">
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
                onClick={() => setBreakdownBuilderModalOpen(true)}
                variant="outline"
                size="sm"
                className={cn(
                  "flex items-center gap-2",
                  isDayPhase ? "bg-white/90" : "bg-white/10"
                )}
              >
                <ClipboardList className="w-4 h-4" />
                Breakdown Builder
              </Button>

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

              {gameData.phase === "signup" && gameData.serverId && (
                <Button
                  onClick={() => setServerRolesModalOpen(true)}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex items-center gap-2",
                    isDayPhase ? "bg-white/90" : "bg-white/10"
                  )}
                >
                  <Server className="w-4 h-4" />
                  Server Roles
                </Button>
              )}
            </div>
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
                  Selected Roles ({selectedRoleSlots.length})
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
                      <Button
                        onClick={resetThemeSettings}
                        size="sm"
                        variant="destructive"
                        className="w-full"
                      >
                        Reset Theme Settings
                      </Button>
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
                            const selectedCount = selectedRoleSlots.filter((s) => s.role.id === role.id).length
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
                      const selectedCount = selectedRoleSlots.filter((s) => s.role.id === role.id).length
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
                    selectedRoleSlots.reduce(
                      (acc, slot, index) => {
                        const name = slot.role.name
                        if (!acc[name]) {
                          acc[name] = { role: slot.role, count: 0, indices: [] as number[] }
                        }
                        acc[name].count++
                        acc[name].indices.push(index)
                        return acc
                      },
                      {} as Record<string, { role: Role; count: number; indices: number[] }>,
                    ),
                  ).map(([roleName, { role, count, indices }]) => {
                    const firstIdx = indices[0]
                    const sample = selectedRoleSlots[firstIdx]
                    const chargeVal =
                      sample?.charges !== undefined ? sample.charges : role.defaultCharges || 0
                    const winVal =
                      sample?.winByNumber !== undefined ? sample.winByNumber : role.defaultWinByNumber || 0
                    return (
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
                              Charges: {chargeVal}
                            </span>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateRoleCharges(role.id, chargeVal + 1)}
                                className="px-2 py-1 h-5 text-xs"
                                disabled={chargeVal >= 10}
                              >
                                +
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => updateRoleCharges(role.id, Math.max(0, chargeVal - 1))}
                                className="px-2 py-1 h-5 text-xs"
                                disabled={chargeVal <= 0}
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
                              Win by number: {winVal}
                            </span>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateRoleWinByNumber(role.id, winVal + 1)}
                                className="px-2 py-1 h-5 text-xs"
                                disabled={winVal >= 20}
                              >
                                +
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => updateRoleWinByNumber(role.id, Math.max(0, winVal - 1))}
                                className="px-2 py-1 h-5 text-xs"
                                disabled={winVal <= 0}
                              >
                                -
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                    </div>
                  )
                  })}
                  {selectedRoleSlots.length === 0 && (
                    <p className={cn("text-center py-4", isDayPhase ? "text-gray-500" : "text-gray-300")}>
                      No roles selected. Click on roles above to add them.
                    </p>
                  )}
                </div>

                {/* Custom Role Names (when themed) — one field per selected seat */}
                {gameData.isThemed && selectedRoleSlots.length > 0 && (
                  <div className="pt-4 border-t border-white/20">
                    <h4 className={cn("font-medium mb-3 text-sm", isDayPhase ? "text-gray-900" : "text-white")}>
                      Custom Role Names
                    </h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {selectedRoleSlots.map((slot, index) => {
                        const dupIndex = selectedRoleSlots
                          .slice(0, index + 1)
                          .filter((s) => s.role.id === slot.role.id).length
                        const hasDupes =
                          dupIndex > 1 ||
                          selectedRoleSlots.some((s, i) => i > index && s.role.id === slot.role.id)
                        const label = hasDupes ? `${slot.role.name} (${dupIndex})` : slot.role.name
                        return (
                          <div key={`slot-${index}`} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={cn("text-xs font-medium", isDayPhase ? "text-gray-700" : "text-gray-300")}>
                                {label}
                              </span>
                            </div>
                            <Input
                              placeholder={`Custom name for ${slot.role.name}...`}
                              value={slot.customName}
                              onChange={(e) => updateSlotCustomName(index, e.target.value)}
                              className="text-sm"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Save Game Roles Button */}
                <div className="pt-4 border-t border-white/20">
                  <Button
                    onClick={saveGameRoles}
                    className="w-full"
                    disabled={selectedRoleSlots.length === 0}
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
                  disabled={selectedRoleSlots.length !== players.length}
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

      {/* Breakdown Builder Modal */}
      <BreakdownBuilderModal
        isOpen={breakdownBuilderModalOpen}
        onClose={() => setBreakdownBuilderModalOpen(false)}
        availableRoles={availableRoles}
        gameId={gameId}
        isDayPhase={isDayPhase}
      />

      {/* Server Roles Modal */}
      {gameData.serverId && (
        <ServerRolesModal
          serverId={gameData.serverId}
          isOpen={serverRolesModalOpen}
          onClose={() => setServerRolesModalOpen(false)}
        />
      )}
    </div>
  )
}
