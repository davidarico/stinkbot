"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { X, Copy, Plus, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

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

interface GameRole {
  role_id: number
  role_name: string
  role_count: number
  custom_name?: string
  charges?: number
  win_by_number?: number
  role_team?: string
  has_charges?: boolean
  default_charges?: number
  has_win_by_number?: boolean
  default_win_by_number?: number
  in_wolf_chat?: boolean
}

interface BreakdownBuilderModalProps {
  isOpen: boolean
  onClose: () => void
  availableRoles: Role[]
  gameId: string
  isDayPhase: boolean
}

export function BreakdownBuilderModal({ 
  isOpen, 
  onClose, 
  availableRoles,
  gameId,
  isDayPhase 
}: BreakdownBuilderModalProps) {
  const { toast } = useToast()
  const [breakdownRoles, setBreakdownRoles] = useState<Role[]>([])
  const [gameRolesInBreakdown, setGameRolesInBreakdown] = useState<Role[]>([])

  // Load player roles when modal opens
  useEffect(() => {
    if (isOpen) {
      loadPlayerRoles()
    }
  }, [isOpen, gameId])

  const loadPlayerRoles = async () => {
    try {
      const response = await fetch(`/api/games/${gameId}/player-roles`)
      if (response.ok) {
        const playerRolesData = await response.json()
        const initialGameRoles: Role[] = []
        playerRolesData.forEach((pr: any) => {
          initialGameRoles.push({
            id: pr.role_id,
            name: pr.role_name,
            alignment: pr.role_team || pr.team || 'town', // Handle both field names from database
            description: '',
            hasCharges: pr.has_charges || false,
            defaultCharges: pr.default_charges || 0,
            hasWinByNumber: pr.has_win_by_number || false,
            defaultWinByNumber: pr.default_win_by_number || 0,
            inWolfChat: pr.in_wolf_chat || false
          })
        })
        setGameRolesInBreakdown(sortRolesByAlignmentAndName(initialGameRoles))
      }
    } catch (error) {
      console.error('Error loading player roles:', error)
      toast({
        title: "Error",
        description: "Failed to load player roles",
        variant: "destructive",
      })
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

  const addRoleToBreakdown = (role: Role) => {
    const newBreakdownRoles = [...breakdownRoles, role]
    setBreakdownRoles(sortRolesByAlignmentAndName(newBreakdownRoles))
  }

  const removeRoleFromBreakdown = (roleIndex: number) => {
    const newBreakdownRoles = breakdownRoles.filter((_, index) => index !== roleIndex)
    setBreakdownRoles(sortRolesByAlignmentAndName(newBreakdownRoles))
  }

  const clearBreakdown = () => {
    setBreakdownRoles([])
  }

  const generateBreakdownText = (): string => {
    const allRoles = [...gameRolesInBreakdown, ...breakdownRoles]
    if (allRoles.length === 0) {
      return "No roles in breakdown list"
    }

    // Create a map to track role counts
    const roleCounts = new Map<string, number>()
    allRoles.forEach(role => {
      const count = roleCounts.get(role.name) || 0
      roleCounts.set(role.name, count + 1)
    })

    // Group roles by alignment, showing unique roles with counts
    const grouped = allRoles.reduce((acc, role) => {
      if (!acc[role.alignment]) {
        acc[role.alignment] = new Set<string>()
      }
      acc[role.alignment].add(role.name)
      return acc
    }, {} as Record<string, Set<string>>)

    let breakdown = "**Role Breakdown**\n\n"
    
    if (grouped.town?.size) {
      breakdown += "**Town:**\n"
      Array.from(grouped.town).sort().forEach(roleName => {
        const count = roleCounts.get(roleName) || 1
        breakdown += `• ${roleName}${count > 1 ? ` (x${count})` : ''}\n`
      })
      breakdown += "\n"
    }
    
    if (grouped.wolf?.size) {
      breakdown += "**Wolves:**\n"
      Array.from(grouped.wolf).sort().forEach(roleName => {
        const count = roleCounts.get(roleName) || 1
        breakdown += `• ${roleName}${count > 1 ? ` (x${count})` : ''}\n`
      })
      breakdown += "\n"
    }
    
    if (grouped.neutral?.size) {
      breakdown += "**Neutrals:**\n"
      Array.from(grouped.neutral).sort().forEach(roleName => {
        const count = roleCounts.get(roleName) || 1
        breakdown += `• ${roleName}${count > 1 ? ` (x${count})` : ''}\n`
      })
    }

    return breakdown.trim()
  }

  const copyToClipboard = async () => {
    const breakdownText = generateBreakdownText()
    try {
      await navigator.clipboard.writeText(breakdownText)
      toast({
        title: "Copied to Clipboard",
        description: "Role breakdown has been copied to your clipboard.",
      })
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy to clipboard. Please try again.",
        variant: "destructive",
      })
    }
  }

  // Get roles not in breakdown list (excluding game roles)
  const allBreakdownRoles = [...gameRolesInBreakdown, ...breakdownRoles]
  const availableForBreakdown = availableRoles.filter(role => 
    !allBreakdownRoles.some(br => br.id === role.id)
  )

  // Group available roles by alignment
  const availableByAlignment = availableForBreakdown.reduce((acc, role) => {
    if (!acc[role.alignment]) {
      acc[role.alignment] = []
    }
    acc[role.alignment].push(role)
    return acc
  }, {} as Record<string, Role[]>)

  // Sort each alignment group alphabetically
  Object.keys(availableByAlignment).forEach(alignment => {
    availableByAlignment[alignment].sort((a, b) => a.name.localeCompare(b.name))
  })

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className={cn(
        "border rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto m-4",
        isDayPhase ? "bg-white/95 text-gray-900 border-gray-300" : "bg-gray-900 border-gray-700 text-white"
      )}>
        <div className={cn(
          "flex items-center justify-between p-6 border-b",
          isDayPhase ? "border-gray-300" : "border-gray-700"
        )}>
          <div className="flex items-center gap-2">
            <h2 className={cn("text-xl font-semibold", isDayPhase ? "text-gray-900" : "text-white")}>
              Breakdown Builder
            </h2>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClose} 
            className={cn(
              isDayPhase 
                ? "text-gray-900 hover:text-gray-700 hover:bg-gray-100" 
                : "text-gray-100 hover:text-white hover:bg-gray-800"
            )}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Available Roles */}
            <Card className={cn(
              isDayPhase ? "bg-white/90 border-gray-200" : "bg-white/10 border-white/20"
            )}>
              <CardHeader>
                <CardTitle className={cn(isDayPhase ? "text-gray-900" : "text-white")}>
                  Available Roles
                </CardTitle>
                <p className={cn("text-sm", isDayPhase ? "text-gray-600" : "text-gray-300")}>
                  Click on roles to add them to the breakdown list
                </p>
              </CardHeader>
              <CardContent className="space-y-4 max-h-96 overflow-y-auto">
                {Object.entries(availableByAlignment).map(([alignment, roles]) => (
                  <div key={alignment} className="space-y-2">
                    <div className={cn(
                      "text-sm font-semibold uppercase tracking-wide px-2 py-1 rounded",
                      alignment === "town" ? "text-blue-600 bg-blue-100/50" :
                      alignment === "wolf" ? "text-red-600 bg-red-100/50" :
                      "text-yellow-600 bg-yellow-100/50",
                      !isDayPhase && (
                        alignment === "town" ? "text-blue-300 bg-blue-900/20" :
                        alignment === "wolf" ? "text-red-300 bg-red-900/20" :
                        "text-yellow-300 bg-yellow-900/20"
                      )
                    )}>
                      {alignment} ({roles.length})
                    </div>
                    <div className="ml-4 space-y-1">
                      {roles.map((role) => (
                        <div
                          key={role.id}
                          className={cn(
                            "p-2 rounded border cursor-pointer hover:bg-opacity-80 transition-colors",
                            isDayPhase
                              ? "bg-white border-gray-200 hover:bg-gray-50"
                              : "bg-white/5 border-white/20 hover:bg-white/10"
                          )}
                          onClick={() => addRoleToBreakdown(role)}
                        >
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                {role.name}
                              </span>
                            </div>
                            <Plus className="w-4 h-4 text-gray-400" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {availableForBreakdown.length === 0 && (
                  <p className={cn("text-center py-4 text-sm", isDayPhase ? "text-gray-500" : "text-gray-300")}>
                    All available roles have been added to the breakdown list.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Breakdown List */}
            <Card className={cn(
              isDayPhase ? "bg-white/90 border-gray-200" : "bg-white/10 border-white/20"
            )}>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className={cn(isDayPhase ? "text-gray-900" : "text-white")}>
                    Breakdown List ({allBreakdownRoles.length})
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearBreakdown}
                      disabled={breakdownRoles.length === 0}
                      className={cn(
                        isDayPhase ? "border-gray-300" : "border-gray-600"
                      )}
                    >
                      Clear Added
                    </Button>
                    <Button
                      size="sm"
                      onClick={copyToClipboard}
                      disabled={allBreakdownRoles.length === 0}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                </div>
                <p className={cn("text-sm", isDayPhase ? "text-gray-600" : "text-gray-300")}>
                  Roles organized by alignment and alphabetically
                </p>
              </CardHeader>
              <CardContent className="space-y-4 max-h-96 overflow-y-auto">
                {allBreakdownRoles.length > 0 ? (
                  <div className="space-y-4">
                    {["town", "wolf", "neutral"].map((alignment) => {
                      const allRolesInAlignment = allBreakdownRoles.filter(role => role.alignment === alignment)
                      
                      // Create unique roles with counts
                      const uniqueRoles = new Map<string, { role: Role, count: number, isGameRole: boolean }>()
                      
                      allRolesInAlignment.forEach(role => {
                        const existing = uniqueRoles.get(role.name)
                        if (existing) {
                          existing.count++
                        } else {
                          const isGameRole = gameRolesInBreakdown.some(gr => gr.id === role.id && gr.name === role.name)
                          uniqueRoles.set(role.name, { role, count: 1, isGameRole })
                        }
                      })
                      
                      if (uniqueRoles.size === 0) return null
                      
                      return (
                        <div key={alignment} className="space-y-2">
                          <div className={cn(
                            "text-sm font-semibold uppercase tracking-wide px-2 py-1 rounded",
                            alignment === "town" ? "text-blue-600 bg-blue-100/50" :
                            alignment === "wolf" ? "text-red-600 bg-red-100/50" :
                            "text-yellow-600 bg-yellow-100/50",
                            !isDayPhase && (
                              alignment === "town" ? "text-blue-300 bg-blue-900/20" :
                              alignment === "wolf" ? "text-red-300 bg-red-900/20" :
                              "text-yellow-300 bg-yellow-900/20"
                            )
                          )}>
                            {alignment} ({uniqueRoles.size})
                          </div>
                          <div className="ml-4 space-y-1">
                            {Array.from(uniqueRoles.entries()).map(([roleName, { role, count, isGameRole }]) => (
                              <div
                                key={`${isGameRole ? 'game' : 'user'}-${role.id}-${roleName}`}
                                className={cn(
                                  "p-2 rounded border flex justify-between items-center",
                                  isGameRole 
                                    ? isDayPhase
                                      ? "bg-gray-50 border-gray-200"
                                      : "bg-gray-800/20 border-gray-600"
                                    : isDayPhase
                                      ? "bg-green-50 border-green-200"
                                      : "bg-green-900/20 border-green-700"
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={cn("font-medium", isDayPhase ? "text-gray-900" : "text-white")}>
                                    {roleName}
                                  </span>
                                  {count > 1 && (
                                    <Badge variant="outline" className="text-xs bg-orange-50">
                                      x{count}
                                    </Badge>
                                  )}
                                  {isGameRole && (
                                    <Badge variant="outline" className="text-xs bg-blue-50">
                                      In Game
                                    </Badge>
                                  )}
                                </div>
                                {!isGameRole && (
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => {
                                      // Find the first occurrence of this role in breakdownRoles and remove it
                                      const index = breakdownRoles.findIndex(r => r.id === role.id)
                                      if (index !== -1) {
                                        removeRoleFromBreakdown(index)
                                      }
                                    }}
                                    className="px-2 py-1 h-6"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className={cn("text-center py-8 text-sm", isDayPhase ? "text-gray-500" : "text-gray-300")}>
                    No roles in breakdown list. Game roles will appear here automatically.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

        </div>

        <div className={cn(
          "flex items-center justify-end gap-2 p-6 border-t",
          isDayPhase ? "border-gray-300" : "border-gray-700"
        )}>
          <Button 
            variant="outline" 
            onClick={onClose} 
            className={cn(
              "bg-gray-900 hover:bg-gray-800 text-white",
            )}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
