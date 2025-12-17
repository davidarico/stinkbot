'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, Plus, ArrowLeft, Trash2, Server } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface Server {
  server_id: string
  server_name: string | null
}

interface Role {
  id: number
  name: string
  alignment?: string
  description?: string
  targets?: string
  moves?: boolean
  standardResultsFlavor?: string
  immunities?: string
  specialProperties?: string
  framerInteraction?: string
  inWolfChat?: boolean
  hasCharges?: boolean
  defaultCharges?: number
  hasWinByNumber?: boolean
  defaultWinByNumber?: number
  isSpotlight?: boolean
  serverId?: string
}

export default function ServerRolesPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const [selectedServer, setSelectedServer] = useState<string | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newRole, setNewRole] = useState({
    name: '',
    team: 'town',
    description: '',
    targets: '',
    moves: false,
    standardResultsFlavor: '',
    immunities: '',
    specialProperties: '',
    framerInteraction: '',
    inWolfChat: false,
    hasCharges: false,
    defaultCharges: 0,
    hasWinByNumber: false,
    defaultWinByNumber: 0,
    isSpotlight: false
  })
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    checkAuthentication()
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      fetchServers()
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (selectedServer) {
      fetchServerRoles(selectedServer)
    } else {
      setRoles([])
    }
  }, [selectedServer])

  const checkAuthentication = async () => {
    try {
      const response = await fetch('/api/admin/verify')
      const data = await response.json()
      setIsAuthenticated(data.authenticated)
    } catch (error) {
      console.error('Error checking authentication:', error)
      setIsAuthenticated(false)
    }
  }

  const fetchServers = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/admin/servers')
      const data = await response.json()
      
      if (data.success) {
        setServers(data.servers)
      } else {
        setError('Failed to fetch servers')
      }
    } catch (error) {
      console.error('Error fetching servers:', error)
      setError('Failed to fetch servers')
    } finally {
      setIsLoading(false)
    }
  }

  const fetchServerRoles = async (serverId: string) => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/admin/servers/${serverId}/roles`)
      const data = await response.json()
      
      if (data.success) {
        setRoles(data.roles)
      } else {
        setError('Failed to fetch server roles')
      }
    } catch (error) {
      console.error('Error fetching server roles:', error)
      setError('Failed to fetch server roles')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateRole = async () => {
    if (!selectedServer || !newRole.name.trim()) {
      toast({
        title: "Error",
        description: "Please select a server and enter a role name",
        variant: "destructive",
      })
      return
    }

    try {
      setIsCreating(true)
      const response = await fetch(`/api/admin/servers/${selectedServer}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRole)
      })

      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Role created successfully",
        })
        setIsDialogOpen(false)
        setNewRole({
          name: '',
          team: 'town',
          description: '',
          targets: '',
          moves: false,
          standardResultsFlavor: '',
          immunities: '',
          specialProperties: '',
          framerInteraction: '',
          inWolfChat: false,
          hasCharges: false,
          defaultCharges: 0,
          hasWinByNumber: false,
          defaultWinByNumber: 0,
          isSpotlight: false
        })
        fetchServerRoles(selectedServer)
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to create role",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error creating role:', error)
      toast({
        title: "Error",
        description: "Failed to create role",
        variant: "destructive",
      })
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteRole = async (roleId: number) => {
    if (!confirm('Are you sure you want to delete this role?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/roles/${roleId}`, {
        method: 'DELETE'
      })

      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Role deleted successfully",
        })
        if (selectedServer) {
          fetchServerRoles(selectedServer)
        }
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to delete role",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error deleting role:', error)
      toast({
        title: "Error",
        description: "Failed to delete role",
        variant: "destructive",
      })
    }
  }

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    )
  }

  if (!isAuthenticated) {
    router.push('/admin')
    return null
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => router.push('/admin')}
              className="border-gray-600 text-gray-300 hover:bg-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-white">Server-Specific Roles</h1>
              <p className="text-gray-300 mt-2">Manage roles for specific Discord servers</p>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card className="bg-gray-800 border-gray-700 mb-6">
          <CardHeader>
            <CardTitle className="text-white">Select Server</CardTitle>
            <CardDescription className="text-gray-300">
              Choose a server to manage its roles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={selectedServer || ''} onValueChange={setSelectedServer}>
              <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                <SelectValue placeholder="Select a server" />
              </SelectTrigger>
              <SelectContent>
                {servers.map((server) => (
                  <SelectItem key={server.server_id} value={server.server_id}>
                    {server.server_name || server.server_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {selectedServer && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">
                Roles for {servers.find(s => s.server_id === selectedServer)?.server_name || selectedServer}
              </h2>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Role
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-gray-800 border-gray-700 text-white max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="text-white">Create Server-Specific Role</DialogTitle>
                    <DialogDescription className="text-gray-300">
                      Add a new role that will only be available on this server
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name" className="text-white">Role Name *</Label>
                      <Input
                        id="name"
                        value={newRole.name}
                        onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                        className="bg-gray-700 border-gray-600 text-white"
                        placeholder="e.g., Custom Seer"
                      />
                    </div>
                    <div>
                      <Label htmlFor="team" className="text-white">Team</Label>
                      <Select value={newRole.team} onValueChange={(value) => setNewRole({ ...newRole, team: value })}>
                        <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="town">Town</SelectItem>
                          <SelectItem value="wolf">Wolf</SelectItem>
                          <SelectItem value="neutral">Neutral</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="description" className="text-white">Description</Label>
                      <Textarea
                        id="description"
                        value={newRole.description}
                        onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                        className="bg-gray-700 border-gray-600 text-white"
                        placeholder="Role description"
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label htmlFor="targets" className="text-white">Targets</Label>
                      <Input
                        id="targets"
                        value={newRole.targets}
                        onChange={(e) => setNewRole({ ...newRole, targets: e.target.value })}
                        className="bg-gray-700 border-gray-600 text-white"
                        placeholder="e.g., Players, Houses"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="moves"
                        checked={newRole.moves}
                        onCheckedChange={(checked) => setNewRole({ ...newRole, moves: checked as boolean })}
                      />
                      <Label htmlFor="moves" className="text-white">Moves</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="inWolfChat"
                        checked={newRole.inWolfChat}
                        onCheckedChange={(checked) => setNewRole({ ...newRole, inWolfChat: checked as boolean })}
                      />
                      <Label htmlFor="inWolfChat" className="text-white">In Wolf Chat</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="hasCharges"
                        checked={newRole.hasCharges}
                        onCheckedChange={(checked) => setNewRole({ ...newRole, hasCharges: checked as boolean })}
                      />
                      <Label htmlFor="hasCharges" className="text-white">Has Charges</Label>
                    </div>
                    {newRole.hasCharges && (
                      <div>
                        <Label htmlFor="defaultCharges" className="text-white">Default Charges</Label>
                        <Input
                          id="defaultCharges"
                          type="number"
                          value={newRole.defaultCharges}
                          onChange={(e) => setNewRole({ ...newRole, defaultCharges: parseInt(e.target.value) || 0 })}
                          className="bg-gray-700 border-gray-600 text-white"
                        />
                      </div>
                    )}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="hasWinByNumber"
                        checked={newRole.hasWinByNumber}
                        onCheckedChange={(checked) => setNewRole({ ...newRole, hasWinByNumber: checked as boolean })}
                      />
                      <Label htmlFor="hasWinByNumber" className="text-white">Has Win By Number</Label>
                    </div>
                    {newRole.hasWinByNumber && (
                      <div>
                        <Label htmlFor="defaultWinByNumber" className="text-white">Default Win By Number</Label>
                        <Input
                          id="defaultWinByNumber"
                          type="number"
                          value={newRole.defaultWinByNumber}
                          onChange={(e) => setNewRole({ ...newRole, defaultWinByNumber: parseInt(e.target.value) || 0 })}
                          className="bg-gray-700 border-gray-600 text-white"
                        />
                      </div>
                    )}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="isSpotlight"
                        checked={newRole.isSpotlight}
                        onCheckedChange={(checked) => setNewRole({ ...newRole, isSpotlight: checked as boolean })}
                      />
                      <Label htmlFor="isSpotlight" className="text-white">Is Spotlight</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsDialogOpen(false)}
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleCreateRole} disabled={isCreating}>
                      {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Role
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            ) : roles.length === 0 ? (
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="py-12 text-center">
                  <Server className="h-12 w-12 mx-auto text-gray-500 mb-4" />
                  <p className="text-gray-400">No server-specific roles found. Create one to get started.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {roles.map((role) => (
                  <Card key={role.id} className="bg-gray-800 border-gray-700">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-white">{role.name}</CardTitle>
                          <CardDescription className="text-gray-300 capitalize">
                            {role.alignment || 'Unknown'}
                          </CardDescription>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteRole(role.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {role.description && (
                        <p className="text-gray-300 text-sm mb-2">{role.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-4">
                        {role.moves && (
                          <span className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded">Moves</span>
                        )}
                        {role.inWolfChat && (
                          <span className="px-2 py-1 bg-purple-600/20 text-purple-300 text-xs rounded">Wolf Chat</span>
                        )}
                        {role.hasCharges && (
                          <span className="px-2 py-1 bg-yellow-600/20 text-yellow-300 text-xs rounded">
                            Charges: {role.defaultCharges}
                          </span>
                        )}
                        {role.isSpotlight && (
                          <span className="px-2 py-1 bg-green-600/20 text-green-300 text-xs rounded">Spotlight</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

