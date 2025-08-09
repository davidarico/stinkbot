"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Users, Plus, X, Trash2 } from "lucide-react"

interface Player {
  id: number
  userId: string
  username: string
  status: "alive" | "dead"
}

interface GameChannel {
  id: number
  channel_name: string
  channel_id?: string
  day_message?: string
  night_message?: string
  open_at_dawn: boolean
  open_at_dusk: boolean
  is_created: boolean
  invited_users?: string[]
}

interface ManageChannelsModalProps {
  gameId: string
  isOpen: boolean
  onClose: () => void
}

export function ManageChannelsModal({ gameId, isOpen, onClose }: ManageChannelsModalProps) {
  const { toast } = useToast()
  const [channels, setChannels] = useState<GameChannel[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string>("")
  const [channelToDelete, setChannelToDelete] = useState<GameChannel | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadData()
      setSelectedUserId("") // Reset selection when modal opens
    }
  }, [isOpen, gameId])

  const loadData = async () => {
    try {
      setLoading(true)
      
      // Load channels
      const channelsResponse = await fetch(`/api/games/${gameId}/channels`)
      if (channelsResponse.ok) {
        const channelsData = await channelsResponse.json()
        setChannels(channelsData)
      }

      // Load players
      const playersResponse = await fetch(`/api/games/${gameId}/players`)
      if (playersResponse.ok) {
        const playersData = await playersResponse.json()
        setPlayers(playersData)
      }
    } catch (error) {
      console.error('Error loading data:', error)
      toast({
        title: "Error",
        description: "Failed to load channels and players",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const addUserToChannel = async (channelId: number, userId: string) => {
    if (!userId.trim()) return

    try {
      const response = await fetch(`/api/games/${gameId}/channels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addInvitedUser',
          channelId,
          userId
        })
      })

      if (response.ok) {
        // Reload channels to get updated data
        const channelsResponse = await fetch(`/api/games/${gameId}/channels`)
        if (channelsResponse.ok) {
          const channelsData = await channelsResponse.json()
          setChannels(channelsData)
        }
        
        const player = players.find(p => p.userId === userId)
        toast({
          title: "Success",
          description: `Added ${player?.username || 'user'} to channel`,
        })
        setSelectedUserId("")
      } else {
        toast({
          title: "Error",
          description: "Failed to add user to channel",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error adding user to channel:', error)
      toast({
        title: "Error",
        description: "Failed to add user to channel",
        variant: "destructive",
      })
    }
  }

  const removeUserFromChannel = async (channelId: number, userId: string) => {
    try {
      const response = await fetch(`/api/games/${gameId}/channels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'removeInvitedUser',
          channelId,
          userId
        })
      })

      if (response.ok) {
        // Reload channels to get updated data
        const channelsResponse = await fetch(`/api/games/${gameId}/channels`)
        if (channelsResponse.ok) {
          const channelsData = await channelsResponse.json()
          setChannels(channelsData)
        }
        
        const player = players.find(p => p.userId === userId)
        toast({
          title: "Success",
          description: `Removed ${player?.username || 'user'} from channel`,
        })
      } else {
        toast({
          title: "Error",
          description: "Failed to remove user from channel",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error removing user from channel:', error)
      toast({
        title: "Error",
        description: "Failed to remove user from channel",
        variant: "destructive",
      })
    }
  }

  const getAvailableUsers = (channel: GameChannel) => {
    const invitedUsers = channel.invited_users || []
    const available = players.filter(player => !invitedUsers.includes(player.userId))
    return available
  }

  const getUsernameFromUserId = (userId: string) => {
    const player = players.find(p => p.userId === userId)
    return player?.username || userId
  }

  const handleDeleteChannel = (channel: GameChannel) => {
    setChannelToDelete(channel)
    setShowDeleteConfirm(true)
  }

  const confirmDeleteChannel = async () => {
    if (!channelToDelete) return

    try {
      const response = await fetch(`/api/games/${gameId}/channels?channelId=${channelToDelete.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        // Reload channels to get updated data
        const channelsResponse = await fetch(`/api/games/${gameId}/channels`)
        if (channelsResponse.ok) {
          const channelsData = await channelsResponse.json()
          setChannels(channelsData)
        }
        
        toast({
          title: "Success",
          description: `Deleted channel "${channelToDelete.channel_name}"`,
        })
      } else {
        toast({
          title: "Error",
          description: "Failed to delete channel",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error deleting channel:', error)
      toast({
        title: "Error",
        description: "Failed to delete channel",
        variant: "destructive",
      })
    } finally {
      setShowDeleteConfirm(false)
      setChannelToDelete(null)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-gray-900 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Users className="w-5 h-5" />
            Manage Channels
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="text-center py-8">
            <p className="text-gray-300">Loading channels...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {channels.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400">No channels found for this game.</p>
              </div>
            ) : (
              channels.map((channel) => {
                const availableUsers = getAvailableUsers(channel)
                const invitedUsers = channel.invited_users || []

                return (
                  <Card key={channel.id} className="bg-gray-800 border-gray-600">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between text-white">
                        <div className="flex items-center gap-2">
                          <span>{channel.channel_name}</span>
                          {channel.is_created && (
                            <Badge variant="secondary" className="text-xs bg-gray-700 text-gray-300">
                              Created
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2 text-sm text-gray-400">
                            <span>Dawn: {channel.open_at_dawn ? "Yes" : "No"}</span>
                            <span>Dusk: {channel.open_at_dusk ? "Yes" : "No"}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteChannel(channel)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-900/20 p-2"
                            title="Delete Channel"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Invited Users */}
                      <div>
                        <h4 className="font-medium mb-2 text-white">Invited Users ({invitedUsers.length})</h4>
                        {invitedUsers.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {invitedUsers.map((userId) => (
                              <Badge key={userId} variant="outline" className="flex items-center gap-1 bg-gray-700 border-gray-600 text-gray-300">
                                {getUsernameFromUserId(userId)}
                                <button
                                  onClick={() => removeUserFromChannel(channel.id, userId)}
                                  className="ml-1 hover:text-red-400"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400">No users invited yet</p>
                        )}
                      </div>

                      {/* Add User Section */}
                      {availableUsers.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                                                      <div className="flex-1">
                            <select
                              value={selectedUserId}
                              onChange={(e) => {
                                setSelectedUserId(e.target.value)
                              }}
                              className="w-full bg-gray-700 border-gray-600 text-white rounded-md px-3 py-2"
                            >
                              <option value="">Select a user to invite...</option>
                              {availableUsers.map((player) => (
                                <option key={player.id} value={player.userId}>
                                  {player.username}
                                </option>
                              ))}
                            </select>
                          </div>
                            <Button
                              size="sm"
                              onClick={() => {
                                if (selectedUserId) {
                                  addUserToChannel(channel.id, selectedUserId)
                                }
                              }}
                              disabled={!selectedUserId}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {availableUsers.length === 0 && invitedUsers.length > 0 && (
                        <p className="text-sm text-gray-400">All signed up players are already invited to this channel</p>
                      )}
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        )}
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete Channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-gray-300">
              Are you sure you want to delete the channel "{channelToDelete?.channel_name}"?
            </p>
            <p className="text-sm text-gray-400">
              This action cannot be undone. All channel data and invited users will be permanently removed.
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
                onClick={confirmDeleteChannel}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Delete Channel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
