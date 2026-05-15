"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Search, Filter, Loader2, Star, ArrowLeft } from "lucide-react"
import Link from "next/link"
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
  inWolfChat?: boolean
  isSpotlight?: boolean
  targets?: string
  moves?: boolean
  standardResultsFlavor?: string
  framerInteraction?: string
  immunities?: string
  specialProperties?: string
}

const alignmentStyles = {
  town: {
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    label: "Town",
  },
  wolf: {
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    label: "Wolf",
  },
  neutral: {
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    label: "Neutral",
  },
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
        const response = await fetch("/api/roles")
        if (!response.ok) throw new Error("Failed to fetch roles")
        setRoles(await response.json())
      } catch (err) {
        console.error("Error fetching roles:", err)
        setError("Failed to load roles. Please try again later.")
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading roles…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive-foreground text-sm">{error}</p>
          <Button onClick={() => window.location.reload()} variant="outline" size="sm">
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 60% 35% at 50% -5%, oklch(0.62 0.22 285 / 0.08) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2">
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </Button>
            </Link>
            <div className="h-4 w-px bg-border" />
            <h1 className="text-sm font-semibold text-foreground">Roles</h1>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {filteredRoles.length} / {roles.length}
          </p>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 max-w-6xl">
        {/* Search and filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search roles…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-card border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {(["all", "town", "wolf", "neutral"] as const).map((a) => (
              <Button
                key={a}
                size="sm"
                variant={alignmentFilter === a ? "default" : "outline"}
                onClick={() => setAlignmentFilter(a)}
                className="text-xs capitalize"
              >
                {a === "all" ? (
                  <>
                    <Filter className="w-3 h-3 mr-1" />
                    All ({alignmentCounts.all})
                  </>
                ) : (
                  `${a.charAt(0).toUpperCase() + a.slice(1)} (${alignmentCounts[a]})`
                )}
              </Button>
            ))}
            <Button
              size="sm"
              variant={showSpotlightOnly ? "default" : "outline"}
              onClick={() => setShowSpotlightOnly(!showSpotlightOnly)}
              className="text-xs"
            >
              <Star className="w-3 h-3 mr-1" />
              Spotlight ({spotlightCount})
            </Button>
          </div>
        </div>

        {/* Roles grid */}
        {filteredRoles.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground text-sm mb-4">No roles match your criteria.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchTerm("")
                setAlignmentFilter("all")
                setShowSpotlightOnly(false)
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRoles.map((role) => {
              const style = alignmentStyles[role.alignment]
              return (
                <Card
                  key={role.id}
                  className="bg-card border-border hover:border-border/80 transition-colors"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base font-semibold text-foreground leading-snug">
                        {role.name}
                      </CardTitle>
                      <div className="flex gap-1.5 shrink-0">
                        <Badge className={cn("text-[10px] px-1.5 py-0.5 border font-medium", style.badge)}>
                          {style.label}
                        </Badge>
                        {role.isSpotlight && (
                          <Badge className="text-[10px] px-1.5 py-0.5 border bg-amber-500/10 text-amber-400 border-amber-500/30 font-medium">
                            <Star className="w-2.5 h-2.5 mr-0.5" />
                            Spotlight
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-2.5 text-sm">
                    {role.targets && (
                      <Row label="Targets" value={role.targets} />
                    )}
                    {role.moves && (
                      <Row label="Moves" value="Yes" />
                    )}
                    {role.hasCharges && role.defaultCharges !== undefined && (
                      <Row label="Default Charges" value={String(role.defaultCharges)} mono />
                    )}
                    {role.description && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                        <p className="text-foreground/80 leading-relaxed">{role.description}</p>
                      </div>
                    )}
                    {role.standardResultsFlavor && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Results Flavor</p>
                        <p className="text-foreground/80 leading-relaxed">{role.standardResultsFlavor}</p>
                      </div>
                    )}
                    {role.framerInteraction && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Framer Interaction</p>
                        <p className="text-foreground/80 leading-relaxed">{role.framerInteraction}</p>
                      </div>
                    )}
                    {role.immunities && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Immunities</p>
                        <p className="text-foreground/80 leading-relaxed">{role.immunities}</p>
                      </div>
                    )}
                    {role.specialProperties && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Special Properties</p>
                        <p className="text-foreground/80 leading-relaxed">{role.specialProperties}</p>
                      </div>
                    )}
                    {role.alignment === "wolf" && !role.inWolfChat && (
                      <div className="mt-3 px-2.5 py-2 rounded bg-amber-500/8 border border-amber-500/20">
                        <p className="text-amber-400/90 text-xs">Not added to wolf chat.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-medium text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-foreground/80", mono && "tabular-nums font-mono text-xs")}>{value}</span>
    </div>
  )
}
