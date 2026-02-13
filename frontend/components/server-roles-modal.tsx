"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { Server, Plus, Trash2, Loader2 } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface Role {
  id: number
  name: string
  alignment?: string
  inWolfChat?: boolean
  hasCharges?: boolean
  defaultCharges?: number
  hasWinByNumber?: boolean
  defaultWinByNumber?: number
}

interface ServerRolesModalProps {
  serverId: string
  isOpen: boolean
  onClose: () => void
}

export function ServerRolesModal({ serverId, isOpen, onClose }: ServerRolesModalProps) {
  const { toast } = useToast()
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newRole, setNewRole] = useState({
    name: '',
    team: 'town',
    inWolfChat: false,
    hasCharges: false,
    defaultCharges: 0,
    hasWinByNumber: false,
    defaultWinByNumber: 0,
  })
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    if (isOpen && serverId) {
      fetchServerRoles()
    }
  }, [isOpen, serverId])

  const fetchServerRoles = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/admin/servers/${serverId}/roles`)
      const data = await response.json()
      
      if (data.success) {
        setRoles(data.roles)
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch server roles",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error fetching server roles:', error)
      toast({
        title: "Error",
        description: "Failed to fetch server roles",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateRole = async () => {
    if (!newRole.name.trim()) {
      toast({
        title: "Error",
        description: "Please enter a role name",
        variant: "destructive",
      })
      return
    }

    try {
      setIsCreating(true)
      const response = await fetch(`/api/admin/servers/${serverId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRole.name,
          team: newRole.team,
          inWolfChat: newRole.inWolfChat,
          hasCharges: newRole.hasCharges,
          defaultCharges: newRole.defaultCharges,
          hasWinByNumber: newRole.hasWinByNumber,
          defaultWinByNumber: newRole.defaultWinByNumber,
        })
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
          inWolfChat: false,
          hasCharges: false,
          defaultCharges: 0,
          hasWinByNumber: false,
          defaultWinByNumber: 0,
        })
        fetchServerRoles()
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

  const handleDeleteRole = (role: Role) => {
    setRoleToDelete(role)
    setShowDeleteConfirm(true)
  }

  const confirmDeleteRole = async () => {
    if (!roleToDelete) return

    try {
      const response = await fetch(`/api/admin/roles/${roleToDelete.id}`, {
        method: 'DELETE'
      })

      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Role deleted successfully",
        })
        fetchServerRoles()
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
    } finally {
      setShowDeleteConfirm(false)
      setRoleToDelete(null)
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="!max-w-[95vw] w-[95vw] max-h-[80vh] overflow-y-auto bg-gray-900 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Server className="w-5 h-5" />
              Server-Specific Roles
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-white mx-auto mb-4" />
              <p className="text-gray-300">Loading roles...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  onClick={() => setIsDialogOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Role
                </Button>
              </div>

              {roles.length === 0 ? (
                <div className="text-center py-8">
                  <Server className="h-12 w-12 mx-auto text-gray-500 mb-4" />
                  <p className="text-gray-400">No server-specific roles found. Create one to get started.</p>
                </div>
              ) : (
                <div className="border border-gray-700 rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-800 hover:bg-gray-800">
                        <TableHead className="text-white whitespace-nowrap">Role Name</TableHead>
                        <TableHead className="text-white whitespace-nowrap">Team</TableHead>
                        <TableHead className="text-white whitespace-nowrap">In Wolf Chat</TableHead>
                        <TableHead className="text-white whitespace-nowrap">Has Charges</TableHead>
                        <TableHead className="text-white whitespace-nowrap">Charges</TableHead>
                        <TableHead className="text-white whitespace-nowrap">Has Win By Number</TableHead>
                        <TableHead className="text-white whitespace-nowrap">Win By Number</TableHead>
                        <TableHead className="text-white whitespace-nowrap">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roles.map((role) => (
                        <TableRow key={role.id} className="border-gray-700">
                          <TableCell className="text-white font-medium whitespace-nowrap">{role.name}</TableCell>
                          <TableCell className="text-white capitalize whitespace-nowrap">{role.alignment || 'Unknown'}</TableCell>
                          <TableCell className="text-white whitespace-nowrap">
                            {role.inWolfChat ? 'Yes' : 'No'}
                          </TableCell>
                          <TableCell className="text-white whitespace-nowrap">
                            {role.hasCharges ? 'Yes' : 'No'}
                          </TableCell>
                          <TableCell className="text-white whitespace-nowrap">
                            {role.hasCharges ? role.defaultCharges : '-'}
                          </TableCell>
                          <TableCell className="text-white whitespace-nowrap">
                            {role.hasWinByNumber ? 'Yes' : 'No'}
                          </TableCell>
                          <TableCell className="text-white whitespace-nowrap">
                            {role.hasWinByNumber ? role.defaultWinByNumber : '-'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteRole(role)}
                              className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Role Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Add Server-Specific Role</DialogTitle>
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
                  min="0"
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
                  min="0"
                />
              </div>
            )}
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-gray-300">
              Are you sure you want to delete the role "{roleToDelete?.name}"?
            </p>
            <p className="text-sm text-gray-400">
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteRole}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Delete Role
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

