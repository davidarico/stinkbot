'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Lock, ArrowUpRight } from 'lucide-react'

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  useEffect(() => { checkAuthentication() }, [])

  const checkAuthentication = async () => {
    try {
      const response = await fetch('/api/admin/verify')
      const data = await response.json()
      setIsAuthenticated(data.authenticated)
    } catch {
      setIsAuthenticated(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await response.json()
      if (response.ok && data.success) {
        setIsAuthenticated(true)
        setPassword('')
      } else {
        setError(data.error || 'Authentication failed')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    document.cookie = 'admin-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    setIsAuthenticated(false)
  }

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            background: "radial-gradient(ellipse 60% 40% at 50% -5%, oklch(0.80 0.09 235 / 0.11) 0%, transparent 70%)",
          }}
        />
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-secondary border border-border mb-4">
              <Lock className="h-4 w-4 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Admin Access</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter the admin password to continue.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-muted-foreground">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-card border-border"
                required
              />
            </div>
            {error && (
              <Alert variant="destructive" className="py-2">
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Sign In
            </Button>
          </form>
        </div>
      </div>
    )
  }

  const sections = [
    {
      title: 'User Feedback',
      description: 'Review and manage user feedback from Discord',
      href: '/admin/feedback',
    },
    {
      title: 'Server-Specific Roles',
      description: 'Manage roles for specific Discord servers',
      href: '/admin/server-roles',
    },
  ]

  return (
    <div className="min-h-screen bg-background">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background: "radial-gradient(ellipse 60% 35% at 50% -5%, oklch(0.80 0.09 235 / 0.10) 0%, transparent 70%)",
        }}
      />
      <header className="border-b border-border/60 px-8 h-14 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-[0.10em] uppercase text-foreground/80">
          Stinkwolf Admin
        </span>
        <Button onClick={handleLogout} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-xs">
          Sign out
        </Button>
      </header>

      <main className="container mx-auto px-6 py-10 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Administrative controls and settings.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sections.map((s) => (
            <Card
              key={s.href}
              className="bg-card border-border hover:border-primary/40 hover:bg-accent/30 transition-all cursor-pointer group"
              onClick={() => router.push(s.href)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground">{s.title}</CardTitle>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors mt-0.5" />
                </div>
                <CardDescription className="text-xs text-muted-foreground leading-relaxed mt-1">
                  {s.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}
