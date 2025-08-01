"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Search, Filter, Loader2, Star } from "lucide-react"
import Link from "next/link"

interface Role {
  id: number
  name: string
  alignment: "town" | "wolf" | "neutral"
  description: string
  metadata?: string
  hasInfoFunction?: boolean
  hasCharges?: boolean
  defaultCharges?: number
  inWolfChat?: boolean
  isSpotlight?: boolean
  targets?: string
  moves?: boolean
  standardResultsFlavor?: string
  framerInteraction?: string
  immunities?: string
  specialProperties?: string
}

export default function RolesPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [alignmentFilter, setAlignmentFilter] = useState<string>("all")
  const [showSpotlightOnly, setShowSpotlightOnly] = useState(false)
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/roles')
        if (!response.ok) {
          throw new Error('Failed to fetch roles')
        }
        const data = await response.json()
        setRoles(data)
      } catch (err) {
        console.error('Error fetching roles:', err)
        setError('Failed to load roles. Please try again later.')
      } finally {
        setLoading(false)
      }
    }

    fetchRoles()
  }, [])

  const filteredRoles = roles.filter((role) => {
    const matchesSearch =
      role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      role.description.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesAlignment = alignmentFilter === "all" || role.alignment === alignmentFilter
    const matchesSpotlight = !showSpotlightOnly || role.isSpotlight
    return matchesSearch && matchesAlignment && matchesSpotlight
  })

  const alignmentCounts = {
    all: roles.length,
    town: roles.filter((r) => r.alignment === "town").length,
    wolf: roles.filter((r) => r.alignment === "wolf").length,
    neutral: roles.filter((r) => r.alignment === "neutral").length,
  }

  const spotlightCount = roles.filter((r) => r.isSpotlight).length

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-white animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading roles...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-300 text-lg mb-4">{error}</p>
          <Button onClick={() => window.location.reload()} variant="outline">
            Try Again
          </Button>
        </div>
      </div>
    )
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
            <div className="flex gap-2 flex-wrap">
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
              <Button
                variant={showSpotlightOnly ? "default" : "outline"}
                onClick={() => setShowSpotlightOnly(!showSpotlightOnly)}
                className="border-white/30"
              >
                <Star className="w-4 h-4 mr-2" />
                Spotlight ({spotlightCount})
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
                  <div className="flex gap-2">
                    <Badge
                      variant={
                        role.alignment === "town" ? "default" : role.alignment === "wolf" ? "destructive" : "secondary"
                      }
                    >
                      {role.alignment}
                    </Badge>
                    {role.isSpotlight && (
                      <Badge variant="outline" className="border-yellow-400 text-yellow-300">
                        <Star className="w-3 h-3 mr-1" />
                        Spotlight
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {role.targets && (
                  <div>
                    <span className="text-orange-300 font-medium">Targets:</span>
                    <span className="text-gray-200 ml-2">{role.targets}</span>
                  </div>
                )}
                
                {role.moves && (
                  <div>
                    <span className="text-orange-300 font-medium">Moves:</span>
                    <span className="text-gray-200 ml-2">Yes</span>
                  </div>
                )}
                
                {role.hasCharges && role.defaultCharges !== undefined && (
                  <div>
                    <span className="text-orange-300 font-medium">Default Charges:</span>
                    <span className="text-gray-200 ml-2">{role.defaultCharges}</span>
                  </div>
                )}
                
                {role.description && (
                  <div>
                    <span className="text-orange-300 font-medium">Description:</span>
                    <p className="text-gray-200 mt-1 leading-relaxed">{role.description}</p>
                  </div>
                )}
                
                {role.standardResultsFlavor && (
                  <div>
                    <span className="text-orange-300 font-medium">Standard Results Flavor:</span>
                    <p className="text-gray-200 mt-1 leading-relaxed">{role.standardResultsFlavor}</p>
                  </div>
                )}
                
                {role.framerInteraction && (
                  <div>
                    <span className="text-orange-300 font-medium">Framer Interaction:</span>
                    <p className="text-gray-200 mt-1 leading-relaxed">{role.framerInteraction}</p>
                  </div>
                )}
                
                {role.immunities && (
                  <div>
                    <span className="text-orange-300 font-medium">Immunities:</span>
                    <p className="text-gray-200 mt-1 leading-relaxed">{role.immunities}</p>
                  </div>
                )}
                
                {role.specialProperties && (
                  <div>
                    <span className="text-orange-300 font-medium">Special Properties:</span>
                    <p className="text-gray-200 mt-1 leading-relaxed">{role.specialProperties}</p>
                  </div>
                )}
                
                {/* Warning text for special roles */}
                {(role.alignment === "wolf" && !role.inWolfChat) && (
                  <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded">
                    <p className="text-yellow-300 text-sm">
                     This role is not added to the wolf chat.
                    </p>
                  </div>
                )}
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
                setShowSpotlightOnly(false)
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
