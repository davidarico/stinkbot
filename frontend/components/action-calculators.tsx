"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Calculator, ChevronDown, ChevronRight } from "lucide-react"
import { BartenderCalculator } from "@/components/calculators/bartender-calculator"
import { SleepwalkerCalculator } from "@/components/calculators/sleepwalker-calculator"

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
}

interface ActionCalculatorsProps {
  players: Player[]
  gameRoles: Role[]
  isDayPhase: boolean
}

export function ActionCalculators({ players, gameRoles, isDayPhase }: ActionCalculatorsProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Only show during night phase
  if (isDayPhase) {
    return null
  }

  const alivePlayers = players.filter(p => p.status === "alive")
  
  return (
    <Card className="bg-white/10">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-white/5 transition-colors">
            <CardTitle className="text-white flex items-center gap-2">
              {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              <Calculator className="w-5 h-5" />
              Action Calculators
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <p className="text-gray-300 text-sm">
              Generate night action results for specific roles. Select a calculator below:
            </p>
            
            <div className="space-y-4">
              {/* Bartender Calculator */}
              <BartenderCalculator 
                players={alivePlayers}
                gameRoles={gameRoles}
              />
              
              {/* Sleepwalker Calculator */}
              <SleepwalkerCalculator 
                players={alivePlayers}
              />
              
              {/* Placeholder for future calculators */}
              <Card className="bg-white/5 border-dashed border-white/20">
                <CardContent className="p-4 text-center">
                  <p className="text-gray-400 text-sm">
                    More action calculators coming soon...
                  </p>
                  <p className="text-gray-500 text-xs mt-1">
                    Future: Auraseer, Parity Inspector, Random Number generators, etc.
                  </p>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
