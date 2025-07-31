"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Search, Filter } from "lucide-react"
import Link from "next/link"

interface Role {
  id: number
  name: string
  alignment: "town" | "wolf" | "neutral"
  description: string
  metadata?: string
  hasInfoFunction?: boolean
}

export default function RolesPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [alignmentFilter, setAlignmentFilter] = useState<string>("all")

  // Mock roles data
  const roles: Role[] = [
    {
      id: 1,
      name: "Villager",
      alignment: "town",
      description:
        "A regular townsperson with no special abilities. Their only power is their vote during the day phase. Villagers win when all threats to the town are eliminated.",
    },
    {
      id: 2,
      name: "Seer",
      alignment: "town",
      description:
        "Each night, the Seer can investigate one player to learn their alignment (Town, Wolf, or Neutral). The Seer is a powerful information role that can help guide the town to victory.",
      hasInfoFunction: true,
    },
    {
      id: 3,
      name: "Doctor",
      alignment: "town",
      description:
        "Each night, the Doctor can choose one player to protect from attacks. If that player is targeted for elimination, they will survive. The Doctor cannot protect the same player two nights in a row.",
    },
    {
      id: 4,
      name: "Bodyguard",
      alignment: "town",
      description:
        "The Bodyguard can protect one player each night. If the protected player is attacked, both the Bodyguard and the attacker die instead of the target.",
    },
    {
      id: 5,
      name: "Detective",
      alignment: "town",
      description:
        "Each night, the Detective can investigate a player to learn their exact role. This is more specific than the Seer's alignment check.",
      hasInfoFunction: true,
    },
    {
      id: 6,
      name: "Vigilante",
      alignment: "town",
      description:
        "The Vigilante has the ability to eliminate one player during the night phase. They must be careful not to accidentally kill a fellow town member.",
    },
    {
      id: 7,
      name: "Mayor",
      alignment: "town",
      description:
        "The Mayor's vote counts as two votes during the day phase. They are a powerful voice in town decisions but also a high-priority target for wolves.",
    },
    {
      id: 8,
      name: "Werewolf",
      alignment: "wolf",
      description:
        "The basic wolf role. Each night, all wolves collectively choose one player to eliminate. Wolves win when they equal or outnumber the remaining town members.",
    },
    {
      id: 9,
      name: "Alpha Wolf",
      alignment: "wolf",
      description:
        "The leader of the wolf pack. The Alpha Wolf has the final say in wolf decisions and may have additional abilities depending on the game setup.",
    },
    {
      id: 10,
      name: "Wolf Shaman",
      alignment: "wolf",
      description:
        "A wolf with magical abilities. Can perform special actions in addition to the regular wolf kill. Often has protective or investigative powers for the wolf team.",
    },
    {
      id: 11,
      name: "Traitor",
      alignment: "wolf",
      description:
        "Appears as Town to investigative roles but wins with the wolves. The Traitor doesn't know who the other wolves are and isn't in the wolf chat initially.",
      metadata: "Not added to Wolf Chat initially",
    },
    {
      id: 12,
      name: "Turncoat",
      alignment: "neutral",
      description:
        "The Turncoat can choose to join either the Town or Wolf team during the game. They win with whichever team they choose to support.",
      metadata: "Not added to Wolf Chat",
    },
    {
      id: 13,
      name: "Serial Killer",
      alignment: "neutral",
      description:
        "The Serial Killer kills one player each night and wins by being the last player alive. They are immune to wolf attacks and some other forms of elimination.",
    },
    {
      id: 14,
      name: "Jester",
      alignment: "neutral",
      description:
        "The Jester wins if they are voted out during the day phase. They will try to act suspicious to get themselves eliminated while avoiding night kills.",
    },
    {
      id: 15,
      name: "Survivor",
      alignment: "neutral",
      description:
        "The Survivor simply needs to survive until the end of the game. They win with whoever is victorious as long as they're still alive.",
    },
    {
      id: 16,
      name: "Sleepwalker",
      alignment: "town",
      description:
        "Each night, the Sleepwalker randomly visits another player. They learn who they visited but not what happened. Other players may see the Sleepwalker's visit.",
      hasInfoFunction: true,
    },
    {
      id: 17,
      name: "Bartender",
      alignment: "town",
      description:
        "The Bartender can learn information about players by serving them drinks. They can discover roles and alignments through their investigations.",
      hasInfoFunction: true,
    },
    {
      id: 18,
      name: "Medium",
      alignment: "town",
      description:
        "The Medium can communicate with dead players and learn information from them. This role becomes more powerful as more players are eliminated.",
    },
    {
      id: 19,
      name: "Hunter",
      alignment: "town",
      description:
        "When the Hunter dies, they can immediately eliminate another player of their choice. This creates a powerful deterrent against targeting the Hunter.",
    },
    {
      id: 20,
      name: "Witch",
      alignment: "neutral",
      description:
        "The Witch has potions that can save or kill players. They typically have one healing potion and one poison potion to use during the game.",
    },
  ]

  const filteredRoles = roles.filter((role) => {
    const matchesSearch =
      role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      role.description.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesAlignment = alignmentFilter === "all" || role.alignment === alignmentFilter
    return matchesSearch && matchesAlignment
  })

  const alignmentCounts = {
    all: roles.length,
    town: roles.filter((r) => r.alignment === "town").length,
    wolf: roles.filter((r) => r.alignment === "wolf").length,
    neutral: roles.filter((r) => r.alignment === "neutral").length,
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">Werewolf Roles</h1>
          <p className="text-lg text-purple-200 mb-6">Complete guide to all available roles in Stinkwolf games</p>
          <Link href="/">
            <Button
              variant="outline"
              className="border-purple-400 text-purple-200 hover:bg-purple-800/50 bg-transparent"
            >
              Back to Home
            </Button>
          </Link>
        </div>

        {/* Search and Filter */}
        <div className="bg-white/10 backdrop-blur-lg rounded-lg p-6 mb-8">
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search roles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-white/20 border-white/30 text-white placeholder:text-gray-300"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={alignmentFilter === "all" ? "default" : "outline"}
                onClick={() => setAlignmentFilter("all")}
                className="border-white/30"
              >
                <Filter className="w-4 h-4 mr-2" />
                All ({alignmentCounts.all})
              </Button>
              <Button
                variant={alignmentFilter === "town" ? "default" : "outline"}
                onClick={() => setAlignmentFilter("town")}
                className="border-white/30"
              >
                Town ({alignmentCounts.town})
              </Button>
              <Button
                variant={alignmentFilter === "wolf" ? "default" : "outline"}
                onClick={() => setAlignmentFilter("wolf")}
                className="border-white/30"
              >
                Wolf ({alignmentCounts.wolf})
              </Button>
              <Button
                variant={alignmentFilter === "neutral" ? "default" : "outline"}
                onClick={() => setAlignmentFilter("neutral")}
                className="border-white/30"
              >
                Neutral ({alignmentCounts.neutral})
              </Button>
            </div>
          </div>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRoles.map((role) => (
            <Card
              key={role.id}
              className="bg-white/10 backdrop-blur-lg border-white/20 hover:bg-white/15 transition-colors"
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="text-white text-xl">{role.name}</CardTitle>
                  <Badge
                    variant={
                      role.alignment === "town" ? "default" : role.alignment === "wolf" ? "destructive" : "secondary"
                    }
                    className="ml-2"
                  >
                    {role.alignment}
                  </Badge>
                </div>
                {role.metadata && (
                  <p className="text-sm text-yellow-300 bg-yellow-900/20 px-2 py-1 rounded">{role.metadata}</p>
                )}
                {role.hasInfoFunction && (
                  <Badge variant="outline" className="border-blue-400 text-blue-300 w-fit">
                    Info Role
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-gray-200 leading-relaxed">{role.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredRoles.length === 0 && (
          <div className="text-center py-12">
            <p className="text-xl text-gray-300">No roles found matching your criteria.</p>
            <Button
              onClick={() => {
                setSearchTerm("")
                setAlignmentFilter("all")
              }}
              className="mt-4"
              variant="outline"
            >
              Clear Filters
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
