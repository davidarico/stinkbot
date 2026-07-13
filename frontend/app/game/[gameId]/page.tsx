"use client"

import { useState, useEffect } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, Users, Shuffle, Moon, Sun, Filter, Check, Settings, Plus, ClipboardList, Server } from "lucide-react"
import { cn, shuffleArray } from "@/lib/utils"
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
    // The server validates the HTTP-only session cookie.
    fetch(`/api/games/${gameId}`, { credentials: "same-origin" }).then((response) => {
      if (response.ok) {
      setIsAuthenticated(true)
      loadGameData()
      } else {
      setLoading(false)
      }
    }).catch(() => setLoading(false))
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
        await loadGameData()
      } else {
        toast({
          title: "Authentication Failed",
          description: "Incorrect dashboard password.",
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

  // Day phase removes `.dark` so CSS tokens flip to warm light palette.
  useEffect(() => {
    const root = document.documentElement
    if (!isAuthenticated || loading || error) {
      root.classList.add("dark")
      return
    }
    root.classList.toggle("dark", !isDayPhase)
    return () => {
      root.classList.add("dark")
    }
  }, [isAuthenticated, loading, error, isDayPhase])

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-xl font-semibold text-foreground">Game Access</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter the dashboard password from Discord.</p>
          </div>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Dashboard password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && !loginLoading && handleLogin()}
              disabled={loginLoading}
              className="bg-card border-border"
            />
            <Button onClick={handleLogin} className="w-full" disabled={loginLoading}>
              {loginLoading ? (
                <><span className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin mr-2" />Verifying…</>
              ) : "Access Game"}
            </Button>
            {loading && <p className="text-xs text-muted-foreground text-center">Loading…</p>}
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-sm">Loading game data…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-destructive-foreground">Error: {error}</p>
          <Button onClick={() => window.location.reload()} variant="outline" size="sm">
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-500">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-8 pb-6 border-b border-border/60">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              {isDayPhase ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-primary" />}
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {gameData.phase === "signup"
                  ? "Sign Up Phase"
                  : gameData.phase === "night"
                    ? `Night ${gameData.dayNumber}`
                    : `Day ${gameData.dayNumber}`}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {gameData.serverConfig?.gameName} Game{" "}
              {gameData.serverConfig?.gameCounter ? gameData.serverConfig.gameCounter - 1 : gameId}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">Phase changes are managed by the Discord bot</p>
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              {gameData.phase === "signup" && (
                <>
                  <Button onClick={() => setAddChannelModalOpen(true)} variant="outline" size="sm" className="gap-1.5 text-xs">
                    <Plus className="w-3.5 h-3.5" />
                    Add Channel
                  </Button>
                  <Button onClick={() => setManageChannelsModalOpen(true)} variant="outline" size="sm" className="gap-1.5 text-xs">
                    <Users className="w-3.5 h-3.5" />
                    Manage Channels
                  </Button>
                </>
              )}
              <Button onClick={() => setBreakdownBuilderModalOpen(true)} variant="outline" size="sm" className="gap-1.5 text-xs">
                <ClipboardList className="w-3.5 h-3.5" />
                Breakdown Builder
              </Button>
              <Button onClick={() => setSettingsModalOpen(true)} variant="outline" size="sm" className="gap-1.5 text-xs">
                <Settings className="w-3.5 h-3.5" />
                Settings
              </Button>
              {gameData.phase === "signup" && gameData.serverId && (
                <Button onClick={() => setServerRolesModalOpen(true)} variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Server className="w-3.5 h-3.5" />
                  Server Roles
                </Button>
              )}
            </div>
          </div>
        </div>
        {gameData.phase === "signup" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Signed Up Players */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground text-base">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  Players ({players.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {players.map((player) => (
                    <div key={player.id} className="px-2.5 py-1.5 rounded bg-secondary/50 border border-border/50">
                      <span className="text-sm text-foreground">{player.username}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Role Selection */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-foreground text-base">
                  Selected Roles ({selectedRoleSlots.length})
                </CardTitle>

                {/* Theme Settings */}
                <div className="space-y-3 pt-3 border-t border-border/60">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="themed" checked={gameData.isThemed} onCheckedChange={toggleThemed} />
                      <label htmlFor="themed" className="text-sm text-foreground">Themed</label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="skinned" checked={gameData.isSkinned} disabled={!gameData.isThemed} onCheckedChange={toggleSkinned} />
                      <label htmlFor="skinned" className={cn("text-sm text-foreground", !gameData.isThemed && "opacity-40")}>Skinned</label>
                    </div>
                  </div>
                  {gameData.isThemed && (
                    <div className="space-y-2">
                      <Input placeholder="Theme name…" value={themeInput} onChange={(e) => setThemeInput(e.target.value)} className="text-sm bg-background border-border" />
                      <Button onClick={resetThemeSettings} size="sm" variant="destructive" className="w-full">Reset Theme</Button>
                    </div>
                  )}
                </div>

                <div className="flex gap-4 text-xs tabular-nums">
                  <span className="text-blue-500 dark:text-blue-400">Town: {roleCount.town}</span>
                  <span className="text-red-500 dark:text-red-400">Wolves: {roleCount.wolf}</span>
                  <span className="text-amber-500 dark:text-amber-400">Neutral: {roleCount.neutral}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search roles…"
                    value={roleSearch}
                    onChange={(e) => setRoleSearch(e.target.value)}
                    className="pl-9 bg-background border-border text-sm"
                  />
                </div>

                <div className="flex gap-1.5 flex-wrap">
                  {(["all", "town", "wolf", "neutral"] as const).map((a) => (
                    <Button
                      key={a}
                      size="sm"
                      variant={alignmentFilter === a ? "default" : "outline"}
                      onClick={() => setAlignmentFilter(a)}
                      className="text-xs h-7 capitalize"
                    >
                      {a}
                    </Button>
                  ))}
                </div>

                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {alignmentFilter === "all" ? (
                    ["town", "wolf", "neutral"].map((alignment) => {
                      const rolesInAlignment = filteredRoles.filter(r => r.alignment === alignment)
                      if (rolesInAlignment.length === 0) return null
                      const labelClass = alignment === "town" ? "text-blue-500 dark:text-blue-400" :
                        alignment === "wolf" ? "text-red-500 dark:text-red-400" : "text-amber-500 dark:text-amber-400"
                      return (
                        <div key={alignment} className="space-y-1">
                          <p className={cn("text-[10px] font-semibold uppercase tracking-widest px-1 py-0.5", labelClass)}>
                            {alignment} ({rolesInAlignment.length})
                          </p>
                          {rolesInAlignment.map((role) => {
                            const selectedCount = selectedRoleSlots.filter((s) => s.role.id === role.id).length
                            return (
                              <div
                                key={role.id}
                                className={cn(
                                  "px-2.5 py-1.5 rounded border cursor-pointer transition-colors ml-3 text-sm",
                                  "bg-secondary/40 border-border/50 hover:bg-secondary",
                                  selectedCount > 0 && "ring-1 ring-primary/40 border-primary/30"
                                )}
                                onClick={() => addRoleToGame(role)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground">{role.name}</span>
                                  {selectedCount > 0 && (
                                    <span className="text-[10px] text-primary tabular-nums">×{selectedCount}</span>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })
                  ) : (
                    filteredRoles.map((role) => {
                      const selectedCount = selectedRoleSlots.filter((s) => s.role.id === role.id).length
                      return (
                        <div
                          key={role.id}
                          className={cn(
                            "px-2.5 py-1.5 rounded border cursor-pointer transition-colors text-sm",
                            "bg-secondary/40 border-border/50 hover:bg-secondary",
                            selectedCount > 0 && "ring-1 ring-primary/40 border-primary/30"
                          )}
                          onClick={() => addRoleToGame(role)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{role.name}</span>
                            {selectedCount > 0 && (
                              <span className="text-[10px] text-primary tabular-nums">×{selectedCount}</span>
                            )}
                          </div>
                          {!role.inWolfChat && role.alignment === "wolf" && (
                            <p className="text-[10px] italic mt-0.5 text-amber-500/70">* Not in wolf chat</p>
                          )}
                        </div>
                      )
                    })
                  )}
                  {filteredRoles.length === 0 && (
                    <p className="text-center py-4 text-xs text-muted-foreground">No roles match your search.</p>
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
                      className="px-2.5 py-2 rounded border bg-emerald-500/8 border-emerald-500/20"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{role.name}</span>
                          {count > 1 && (
                            <span className="text-[10px] text-muted-foreground tabular-nums">×{count}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" onClick={() => addRoleToGame(role)} className="px-2 py-0.5 h-6 text-xs">+</Button>
                          <Button size="sm" variant="destructive" onClick={() => removeRoleFromGame(indices[indices.length - 1])} className="px-2 py-0.5 h-6 text-xs">−</Button>
                        </div>
                      </div>
                      {role.hasCharges && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/40 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground tabular-nums">Charges: {chargeVal}</span>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => updateRoleCharges(role.id, chargeVal + 1)} className="px-2 h-5 text-xs" disabled={chargeVal >= 10}>+</Button>
                            <Button size="sm" variant="outline" onClick={() => updateRoleCharges(role.id, Math.max(0, chargeVal - 1))} className="px-2 h-5 text-xs" disabled={chargeVal <= 0}>−</Button>
                          </div>
                        </div>
                      )}
                      {role.hasWinByNumber && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/40 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground tabular-nums">Win by: {winVal}</span>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => updateRoleWinByNumber(role.id, winVal + 1)} className="px-2 h-5 text-xs" disabled={winVal >= 20}>+</Button>
                            <Button size="sm" variant="outline" onClick={() => updateRoleWinByNumber(role.id, Math.max(0, winVal - 1))} className="px-2 h-5 text-xs" disabled={winVal <= 0}>−</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                  })}
                  {selectedRoleSlots.length === 0 && (
                    <p className="text-center py-4 text-xs text-muted-foreground">
                      No roles selected. Click on roles above to add them.
                    </p>
                  )}
                </div>

                {gameData.isThemed && selectedRoleSlots.length > 0 && (
                  <div className="pt-3 border-t border-border/60">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2">Custom Role Names</h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {selectedRoleSlots.map((slot, index) => {
                        const dupIndex = selectedRoleSlots.slice(0, index + 1).filter((s) => s.role.id === slot.role.id).length
                        const hasDupes = dupIndex > 1 || selectedRoleSlots.some((s, i) => i > index && s.role.id === slot.role.id)
                        const label = hasDupes ? `${slot.role.name} (${dupIndex})` : slot.role.name
                        return (
                          <div key={`slot-${index}`} className="space-y-1">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <Input
                              placeholder={`Custom name…`}
                              value={slot.customName}
                              onChange={(e) => updateSlotCustomName(index, e.target.value)}
                              className="text-sm bg-background border-border h-7"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-border/60">
                  <Button onClick={saveGameRoles} className="w-full" disabled={selectedRoleSlots.length === 0}>
                    Save Role Configuration
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Role Assignments */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-foreground text-base">Assignments</CardTitle>
                {players.some((p) => p.role) && (
                  <div className="flex gap-4 text-xs tabular-nums">
                    <span className="text-blue-500 dark:text-blue-400">Town: {assignedRoleCount.town}</span>
                    <span className="text-red-500 dark:text-red-400">Wolves: {assignedRoleCount.wolf}</span>
                    <span className="text-amber-500 dark:text-amber-400">Neutral: {assignedRoleCount.neutral}</span>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <Button onClick={assignRoles} className="w-full mb-3" disabled={selectedRoleSlots.length !== players.length}>
                  <Shuffle className="w-3.5 h-3.5 mr-2" />
                  Assign Roles
                </Button>

                {getCoupleValidationMessage() && (
                  <div className="px-2.5 py-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 mb-3">
                    {getCoupleValidationMessage()}
                  </div>
                )}

                {players.some((p) => p.role) && (
                  <div className="space-y-3">
                    {players.filter((p) => p.alignment === "town").length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-1">Town ({assignedRoleCount.town})</p>
                        <div className="space-y-1">
                          {players.filter((p) => p.alignment === "town").map((player) => (
                            <div key={player.id} className="px-2 py-1 rounded bg-blue-500/8 text-xs text-foreground">
                              {player.username} - {getDisplayRoleName(player)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {players.filter((p) => p.alignment === "wolf").length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-red-500 dark:text-red-400 mb-1">Wolves ({assignedRoleCount.wolf})</p>
                        <div className="space-y-1">
                          {players.filter((p) => p.alignment === "wolf").map((player) => (
                            <div key={player.id} className="px-2 py-1 rounded bg-red-500/8 text-xs text-foreground">
                              {player.username} - {getDisplayRoleName(player)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {players.filter((p) => p.alignment === "neutral").length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-500 dark:text-amber-400 mb-1">Neutrals ({assignedRoleCount.neutral})</p>
                        <div className="space-y-1">
                          {players.filter((p) => p.alignment === "neutral").map((player) => (
                            <div key={player.id} className="px-2 py-1 rounded bg-amber-500/8 text-xs text-foreground">
                              {player.username} - {getDisplayRoleName(player)}
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
                <div className="space-y-3">
                  {(["town", "wolf", "neutral"] as const).map((alignment) => {
                    const alive = players.filter((p) => p.alignment === alignment && p.status === "alive")
                    if (alive.length === 0) return null
                    const labelClass = alignment === "town"
                      ? "text-blue-500 dark:text-blue-400"
                      : alignment === "wolf"
                        ? "text-red-500 dark:text-red-400"
                        : "text-amber-500 dark:text-amber-400"
                    const rowClass = alignment === "town"
                      ? "bg-blue-500/8 border-blue-500/20"
                      : alignment === "wolf"
                        ? "bg-red-500/8 border-red-500/20"
                        : "bg-amber-500/8 border-amber-500/20"
                    const label = alignment === "town" ? "Town" : alignment === "wolf" ? "Wolves" : "Neutrals"
                    return (
                      <Card key={alignment} className="bg-card border-border">
                        <CardHeader className="pb-2">
                          <CardTitle className={cn("text-sm", labelClass)}>
                            {label} ({alive.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {alive.map((player) => (
                            <div key={player.id} className={cn("px-3 py-2 rounded border", rowClass)}>
                              <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-foreground">
                                  {player.username} - {getDisplayRoleName(player)}
                                </span>
                                <Button size="sm" variant="destructive" onClick={() => togglePlayerStatus(player.id)}
                                  className="h-6 px-2 text-xs">Kill</Button>
                              </div>
                              {roleHasCharges(player) && (
                                <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border/30">
                                  <span className="text-xs text-muted-foreground tabular-nums">Charges: {player.charges || 0}</span>
                                  <div className="flex gap-1 ml-auto">
                                    <Button size="sm" variant="outline" onClick={() => updatePlayerCharges(player.id, Math.max(0, (player.charges || 0) - 1))} disabled={(player.charges || 0) <= 0} className="h-5 px-2 text-xs">−</Button>
                                    <Button size="sm" variant="outline" onClick={() => updatePlayerCharges(player.id, (player.charges || 0) + 1)} className="h-5 px-2 text-xs">+</Button>
                                  </div>
                                </div>
                              )}
                              {roleHasWinByNumber(player) && (
                                <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border/30">
                                  <span className="text-xs text-muted-foreground tabular-nums">Win by: {player.winByNumber || 0}</span>
                                  <div className="flex gap-1 ml-auto">
                                    <Button size="sm" variant="outline" onClick={() => updatePlayerWinByNumber(player.id, Math.max(0, (player.winByNumber || 0) - 1))} disabled={(player.winByNumber || 0) <= 0} className="h-5 px-2 text-xs">−</Button>
                                    <Button size="sm" variant="outline" onClick={() => updatePlayerWinByNumber(player.id, (player.winByNumber || 0) + 1)} className="h-5 px-2 text-xs">+</Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )
                  })}

                  {/* Dead Players */}
                  {players.filter((p) => p.status === "dead").length > 0 && (
                    <Card className="bg-card border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">
                          Dead ({players.filter((p) => p.status === "dead").length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1.5">
                        {players.filter((p) => p.status === "dead").map((player) => (
                          <div key={player.id} className="px-2.5 py-1.5 rounded border bg-muted/30 border-border/50 flex justify-between items-center">
                            <span className="text-sm text-muted-foreground line-through">
                              {player.username} - {getDisplayRoleName(player)}
                            </span>
                            <Button size="sm" variant="outline" onClick={() => togglePlayerStatus(player.id)} className="h-6 px-2 text-xs">Revive</Button>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>

              {/* Voting Booth (Day Phase Only) */}
              {gameData.phase === "day" && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-foreground">Voting Booth</CardTitle>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Votes to hang: {gameData.votesToHang}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tally</p>
                      {Object.entries(voteCount).map(([target, count]) => (
                        <div
                          key={target}
                          className={cn(
                            "flex justify-between items-center px-2.5 py-2 rounded border text-sm",
                            count >= gameData.votesToHang
                              ? "bg-red-500/10 border-red-500/25"
                              : "bg-secondary/40 border-border/50",
                          )}
                        >
                          <span className="font-medium text-foreground">{target}</span>
                          <Badge className={cn(
                            "text-xs tabular-nums",
                            count >= gameData.votesToHang
                              ? "bg-red-500/15 text-red-400 border-red-500/25"
                              : "bg-secondary text-muted-foreground border-border"
                          )}>
                            {count}
                          </Badge>
                        </div>
                      ))}
                    </div>

                    {votes.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Individual</p>
                        {votes.map((vote, index) => (
                          <div key={index} className="text-xs px-2.5 py-1.5 rounded bg-secondary/30 text-muted-foreground">
                            <span className="text-foreground font-medium">{vote.voterUsername}</span>
                            {" → "}
                            <span className="text-foreground">{vote.targetUsername}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
