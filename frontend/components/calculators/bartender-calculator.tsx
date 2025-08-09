"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, ChevronRight, Wine, Copy, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface Player {
  id: number
  username: string
  status: "alive" | "dead"
  role?: string
  roleId?: number
  alignment?: string
}

interface Role {
  id: number
  name: string
  alignment: "town" | "wolf" | "neutral"
  description: string
  targets?: string
  immunities?: string
  specialProperties?: string
}

interface BartenderCalculatorProps {
  players: Player[]
  gameRoles: Role[]
}

export function BartenderCalculator({ players, gameRoles }: BartenderCalculatorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<string>("")
  const [targetFramed, setTargetFramed] = useState(false)
  const [results, setResults] = useState<string | null>(null)

  const { toast } = useToast()

  // Check if a role can appear in Bartender information
  const canRoleAppearInBartenderInfo = (roleName: string): boolean => {
    const role = gameRoles.find(r => r.name === roleName)
    if (!role) return true
    
    // Roles that cannot be targeted (like Sleepwalker, Orphan)
    const untargetableRoles = ['Sleepwalker', 'Orphan']
    if (untargetableRoles.includes(roleName)) return false
    
    // Check immunities for untargetable properties
    if (role.immunities?.toLowerCase().includes('untargetable')) return false
    
    // Roles that appear as other roles (like Heir, Rivals)
    const appearsAsOtherRoles = ['Heir', 'Rivals']
    if (appearsAsOtherRoles.includes(roleName)) return false
    
    // Check special properties for roles that appear differently
    if (role.specialProperties?.toLowerCase().includes('appears as') || 
        role.specialProperties?.toLowerCase().includes('shows as')) return false
    
    return true
  }

  // Check if a player is targetable (not UTAH - untargetable at home)
  const isPlayerTargetable = (playerName: string): boolean => {
    const player = players.find(p => p.username === playerName)
    if (!player || !player.role) return true
    
    const role = gameRoles.find(r => r.name === player.role)
    if (!role) return true
    
    // Check if role has UTAH (untargetable at home) immunity
    if (role.immunities?.toLowerCase().includes('utah') || 
        role.immunities?.toLowerCase().includes('untargetable at home')) {
      return false
    }
    
    return true
  }

  const generateResults = () => {
    if (!selectedPlayer) {
      toast({
        title: "No Target Selected",
        description: "Please select a player to investigate",
        variant: "destructive",
      })
      return
    }

    const targetPlayer = players.find(p => p.username === selectedPlayer)
    if (!targetPlayer) {
      toast({
        title: "Player Not Found",
        description: "Selected player not found",
        variant: "destructive",
      })
      return
    }

    // Check if target is UTAH (untargetable at home)
    if (!isPlayerTargetable(selectedPlayer)) {
      toast({
        title: "Target Untargetable",
        description: "The Bartender fails - target is untargetable at home (UTAH)",
        variant: "destructive",
      })
      return
    }
    
    // Get the target's true role (or use framed role if applicable)
    let trueRole = targetPlayer.role || "Unknown"
    
    // If the target's true role cannot appear in Bartender info, exclude it from results
    const trueRoleCanAppear = canRoleAppearInBartenderInfo(trueRole)
    
    // Get all roles that were in the game at the beginning and can appear in Bartender info
    const availableRoles = [...new Set(gameRoles.map(role => role.name))]
      .filter(canRoleAppearInBartenderInfo)
    
    if (availableRoles.length < 3) {
      toast({
        title: "Insufficient Roles",
        description: "Need at least 3 different roles in the game to generate results",
        variant: "destructive",
      })
      return
    }

    // Separate roles by alignment
    const townRoles = availableRoles.filter(roleName => {
      const role = gameRoles.find(r => r.name === roleName)
      return role?.alignment === "town"
    })
    const wolfRoles = availableRoles.filter(roleName => {
      const role = gameRoles.find(r => r.name === roleName)
      return role?.alignment === "wolf"
    })
    const neutralRoles = availableRoles.filter(roleName => {
      const role = gameRoles.find(r => r.name === roleName)
      return role?.alignment === "neutral"
    })

    if (townRoles.length === 0 || wolfRoles.length === 0) {
      toast({
        title: "Missing Alignments",
        description: "Game must have both town and wolf roles for Bartender results",
        variant: "destructive",
      })
      return
    }

    // Generate results according to the rule:
    // Three roles: true role + two lies (if true role can appear)
    // One must be town, one must be wolf, final must be town or neutral
    let resultRoles: string[] = []
    
    // Add the true role (or framed role if framed) - only if it can appear
    if (targetFramed) {
      // If framed, the "true" role should be a wolf role (this is what the bartender sees)
      const randomWolfRole = wolfRoles[Math.floor(Math.random() * wolfRoles.length)]
      resultRoles.push(randomWolfRole)
    } else if (trueRoleCanAppear) {
      resultRoles.push(trueRole)
    }
    // If true role cannot appear, we'll generate 3 random roles following the constraints

    // Determine what roles we still need based on what we already have
    const trueRoleAlignment = gameRoles.find(r => r.name === trueRole)?.alignment || "town"
    const needsTown = !resultRoles.some(role => {
      const alignment = gameRoles.find(r => r.name === role)?.alignment
      return alignment === "town"
    })
    const needsWolf = !resultRoles.some(role => {
      const alignment = gameRoles.find(r => r.name === role)?.alignment
      return alignment === "wolf"
    })

    // Add required roles
    if (needsTown && townRoles.length > 0) {
      const availableTownRoles = townRoles.filter(role => !resultRoles.includes(role))
      if (availableTownRoles.length > 0) {
        const randomTownRole = availableTownRoles[Math.floor(Math.random() * availableTownRoles.length)]
        resultRoles.push(randomTownRole)
      }
    }

    if (needsWolf && wolfRoles.length > 0) {
      const availableWolfRoles = wolfRoles.filter(role => !resultRoles.includes(role))
      if (availableWolfRoles.length > 0) {
        const randomWolfRole = availableWolfRoles[Math.floor(Math.random() * availableWolfRoles.length)]
        resultRoles.push(randomWolfRole)
      }
    }

    // Fill remaining slots with town or neutral roles
    while (resultRoles.length < 3) {
      const remainingOptions = [...townRoles, ...neutralRoles].filter(role => !resultRoles.includes(role))
      if (remainingOptions.length === 0) break
      
      const randomRole = remainingOptions[Math.floor(Math.random() * remainingOptions.length)]
      resultRoles.push(randomRole)
    }

    // Shuffle the results so the true role isn't always first
    resultRoles = resultRoles.sort(() => Math.random() - 0.5)

    let resultText = `**Bartender Investigation: ${selectedPlayer}**${targetFramed ? " (Framed)" : ""}`
    
    if (!trueRoleCanAppear && !targetFramed) {
      resultText += `\n\n⚠️ Note: ${selectedPlayer}'s true role (${trueRole}) cannot appear in Bartender information.`
    }
    
    resultText += `\n\nThe Bartender visits ${selectedPlayer} and receives the following three roles:
• ${resultRoles.join("\n• ")}`
    
    if (trueRoleCanAppear && !targetFramed) {
      resultText += `\n\n*One of these is their true role, two are lies. One role is town, one is wolf, and the final role is either town or neutral.*`
    } else {
      resultText += `\n\n*All three are lies (true role cannot appear in Bartender info). One role is town, one is wolf, and the final role is either town or neutral.*`
    }

    setResults(resultText)
  }

  const copyResults = async () => {
    if (results) {
      await navigator.clipboard.writeText(results)
      toast({
        title: "Copied!",
        description: "Results copied to clipboard",
      })
    }
  }

  const resetCalculator = () => {
    setSelectedPlayer("")
    setTargetFramed(false)
    setResults(null)
  }

  return (
    <Card className="bg-white/5 border-white/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-white/5 transition-colors">
            <CardTitle className="text-white flex items-center gap-2 text-lg">
              {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              <Wine className="w-5 h-5" />
              Bartender Calculator
              <Badge variant="outline" className="ml-auto text-xs">
                Investigation Role
              </Badge>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="text-sm text-gray-300 p-3 bg-white/5 rounded border border-white/10">
              <p className="font-medium mb-2">Bartender Rule:</p>
              <p>The Bartender visits one player per night. They receive three roles that were in the game at the beginning — the targeted player's true role and two lies. One role must be town. One role must be wolf. The final role must either be town or neutral.</p>
              <p className="mt-2 text-xs text-gray-400">
                <strong>Restrictions:</strong> Roles that cannot be targeted (Sleepwalker, Orphan) or appear as other roles (Heir, Rivals) cannot appear in results. Bartender fails if target is untargetable at home (UTAH).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  Target Player
                </label>
                <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
                  <SelectTrigger className="bg-white/10 border-white/20 text-white">
                    <SelectValue placeholder="Select a player to investigate..." />
                  </SelectTrigger>
                  <SelectContent>
                    {players.map((player) => {
                      const isUntargetable = !isPlayerTargetable(player.username)
                      return (
                        <SelectItem 
                          key={player.id} 
                          value={player.username}
                          disabled={isUntargetable}
                        >
                          {player.username} {player.role && `(${player.role})`}
                          {isUntargetable && " ❌ UTAH"}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">
                  ❌ = UTAH (untargetable)
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  Special Conditions
                </label>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="target-framed"
                    checked={targetFramed}
                    onCheckedChange={(checked) => setTargetFramed(checked === true)}
                  />
                  <label htmlFor="target-framed" className="text-sm text-white">
                    Target is Framed?
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={generateResults}
                className="flex-1"
                disabled={!selectedPlayer}
              >
                Generate Results
              </Button>
              
              {results && (
                <>
                  <Button 
                    onClick={copyResults}
                    variant="outline"
                    size="sm"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button 
                    onClick={resetCalculator}
                    variant="outline"
                    size="sm"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>

            {results && (
              <Card className="bg-green-900/20 border-green-700">
                <CardHeader>
                  <CardTitle className="text-green-300 text-lg flex items-center gap-2">
                    <Wine className="w-5 h-5" />
                    Bartender Results
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-green-100 text-sm whitespace-pre-wrap font-mono bg-black/20 p-3 rounded border">
                    {results}
                  </pre>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
