"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, ChevronRight, Moon, Copy, RotateCcw, X } from "lucide-react"
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

interface SleepwalkerCalculatorProps {
  players: Player[]
}

export function SleepwalkerCalculator({ players }: SleepwalkerCalculatorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [avoid1, setAvoid1] = useState<string>("")
  const [avoid2, setAvoid2] = useState<string>("")
  const [results, setResults] = useState<string | null>(null)
  const { toast } = useToast()

  const alivePlayers = players.filter(p => p.status === "alive")

  const generateResults = () => {
    const avoidList = [avoid1, avoid2].filter(name => name.trim() !== "")
    
    // Get all living players not in the avoid list
    const availableTargets = alivePlayers.filter(player => 
      !avoidList.includes(player.username)
    )

    if (availableTargets.length === 0) {
      toast({
        title: "No Available Targets",
        description: "All living players are in the avoid list",
        variant: "destructive",
      })
      return
    }

    // Randomly select a target
    const randomTarget = availableTargets[Math.floor(Math.random() * availableTargets.length)]

    const avoidText = avoidList.length > 0 
      ? `\n\nAvoided players: ${avoidList.join(", ")}`
      : "\n\nNo players avoided"

    const resultText = `**Sleepwalker Target Selection**

The Sleepwalker randomly targets: **${randomTarget.username}**${avoidText}

*Selected from ${availableTargets.length} available living players.*`

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
    setAvoid1("")
    setAvoid2("")
    setResults(null)
  }

  const clearAvoid = (avoidNumber: 1 | 2) => {
    if (avoidNumber === 1) {
      setAvoid1("")
    } else {
      setAvoid2("")
    }
  }

  // Get available players for avoid selection (all alive players)
  const getAvailablePlayersForAvoid = (currentAvoid: string) => {
    return alivePlayers.filter(player => {
      // Don't show players already selected in the other avoid slot
      if (currentAvoid === avoid1) {
        return player.username !== avoid2
      } else {
        return player.username !== avoid1
      }
    })
  }

  return (
    <Card className="bg-white/5 border-white/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-white/5 transition-colors">
            <CardTitle className="text-white flex items-center gap-2 text-lg">
              {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              <Moon className="w-5 h-5" />
              Sleepwalker Calculator
              <Badge variant="outline" className="ml-auto text-xs">
                Random Target
              </Badge>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="text-sm text-gray-300 p-3 bg-white/5 rounded border border-white/10">
              <p className="font-medium mb-2">Sleepwalker Rule:</p>
              <p>The Sleepwalker randomly targets a living player, avoiding up to two specified players. This calculator will randomly select from all available targets.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  Avoid Player 1 (Optional)
                </label>
                <div className="flex items-center gap-2">
                  <Select value={avoid1} onValueChange={setAvoid1}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white flex-1">
                      <SelectValue placeholder="Select player to avoid..." />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailablePlayersForAvoid(avoid1).map((player) => (
                        <SelectItem key={player.id} value={player.username}>
                          {player.username} {player.role && `(${player.role})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {avoid1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => clearAvoid(1)}
                      className="px-2"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  Avoid Player 2 (Optional)
                </label>
                <div className="flex items-center gap-2">
                  <Select value={avoid2} onValueChange={setAvoid2}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white flex-1">
                      <SelectValue placeholder="Select player to avoid..." />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailablePlayersForAvoid(avoid2).map((player) => (
                        <SelectItem key={player.id} value={player.username}>
                          {player.username} {player.role && `(${player.role})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {avoid2 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => clearAvoid(2)}
                      className="px-2"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-400">
              Available targets: {alivePlayers.filter(player => 
                ![avoid1, avoid2].filter(name => name.trim() !== "").includes(player.username)
              ).length} / {alivePlayers.length} living players
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={generateResults}
                className="flex-1"
                disabled={alivePlayers.length === 0}
              >
                Generate Target
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
              <Card className="bg-blue-900/20 border-blue-700">
                <CardHeader>
                  <CardTitle className="text-blue-300 text-lg flex items-center gap-2">
                    <Moon className="w-5 h-5" />
                    Sleepwalker Results
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-blue-100 text-sm whitespace-pre-wrap font-mono bg-black/20 p-3 rounded border">
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
