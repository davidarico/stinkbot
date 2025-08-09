"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { Plus, X, Save } from "lucide-react"

interface AddChannelModalProps {
  gameId: string
  isOpen: boolean
  onClose: () => void
  onChannelAdded: () => void
}

export function AddChannelModal({ gameId, isOpen, onClose, onChannelAdded }: AddChannelModalProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [channelPrefix, setChannelPrefix] = useState("")
  const [loadingPrefix, setLoadingPrefix] = useState(false)
  const [formData, setFormData] = useState({
    channelName: "",
    dayMessage: "",
    nightMessage: "",
    openAtDawn: true,
    openAtDusk: true
  })

  // Load channel prefix when modal opens
  useEffect(() => {
    if (isOpen && gameId) {
      loadChannelPrefix()
    }
  }, [isOpen, gameId])

  const loadChannelPrefix = async () => {
    try {
      setLoadingPrefix(true)
      const response = await fetch(`/api/games/${gameId}/info`)
      if (response.ok) {
        const data = await response.json()
        setChannelPrefix(data.channelPrefix)
      }
    } catch (error) {
      console.error('Error loading channel prefix:', error)
    } finally {
      setLoadingPrefix(false)
    }
  }

  // Sanitize and format channel name
  const sanitizeChannelName = (input: string): string => {
    // Remove prefix if user tries to type it
    let sanitized = input
    if (channelPrefix && sanitized.startsWith(channelPrefix + "-")) {
      sanitized = sanitized.substring(channelPrefix.length + 1)
    }
    
    // Step 1: Convert to lowercase
    sanitized = sanitized.toLowerCase()
    
    // Step 2: Replace spaces with hyphens
    sanitized = sanitized.replace(/\s+/g, '-')
    
    // Step 3: Remove all non-alphanumeric characters except hyphens
    sanitized = sanitized.replace(/[^a-z0-9-]/g, '')
    
    // Step 4: Replace multiple consecutive hyphens with single hyphen
    sanitized = sanitized.replace(/-{2,}/g, '-')
    
    // Step 5: Remove leading hyphens only (allow trailing hyphens during typing)
    sanitized = sanitized.replace(/^-+/g, '')
    
    return sanitized
  }

  // Get the full channel name with prefix
  const getFullChannelName = (): string => {
    if (!channelPrefix || !formData.channelName) return ""
    // Clean up any trailing hyphens for the final name
    const cleanChannelName = formData.channelName.replace(/^-+|-+$/g, '')
    return `${channelPrefix}-${cleanChannelName}`
  }

  // Validate channel name
  const validateChannelName = (name: string): string | null => {
    // Clean up the name for validation (remove trailing hyphens)
    const cleanName = name.replace(/^-+|-+$/g, '')
    
    if (!cleanName.trim()) {
      return "Channel name is required."
    }
    
    if (cleanName.length < 2) {
      return "Channel name must be at least 2 characters long."
    }
    
    if (cleanName.length > 50) {
      return "Channel name must be 50 characters or less."
    }
    
    if (!/^[a-z0-9-]+$/.test(cleanName)) {
      return "Channel name can only contain lowercase letters, numbers, and hyphens."
    }
    
    if (cleanName.startsWith('-') || cleanName.endsWith('-')) {
      return "Channel name cannot start or end with a hyphen."
    }
    
    return null
  }

  const handleSave = async () => {
    const validationError = validateChannelName(formData.channelName)
    if (validationError) {
      toast({
        title: "Validation Error",
        description: validationError,
        variant: "destructive",
      })
      return
    }

    const fullChannelName = getFullChannelName()
    if (!fullChannelName) {
      toast({
        title: "Error",
        description: "Unable to generate channel name. Please try again.",
        variant: "destructive",
      })
      return
    }

    try {
      setLoading(true)
      const response = await fetch(`/api/games/${gameId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelName: fullChannelName,
          dayMessage: formData.dayMessage.trim() || null,
          nightMessage: formData.nightMessage.trim() || null,
          openAtDawn: formData.openAtDawn,
          openAtDusk: formData.openAtDusk
        })
      })

      if (response.ok) {
        toast({
          title: "Channel Added",
          description: "Game channel has been added successfully.",
        })
        onChannelAdded()
        onClose()
        // Reset form
        setFormData({
          channelName: "",
          dayMessage: "",
          nightMessage: "",
          openAtDawn: true,
          openAtDusk: true
        })
      } else {
        const error = await response.json()
        toast({
          title: "Add Failed",
          description: error.error || "Failed to add channel",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error adding channel:', error)
      toast({
        title: "Add Error",
        description: "Error adding channel",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    // Reset form when closing
    setFormData({
      channelName: "",
      dayMessage: "",
      nightMessage: "",
      openAtDawn: true,
      openAtDusk: true
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-white" />
            <h2 className="text-xl font-semibold text-white">Add Game Channel</h2>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Channel Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Channel Name</label>
                <div className="space-y-2">
                  {loadingPrefix ? (
                    <div className="text-sm text-gray-400">Loading prefix...</div>
                  ) : channelPrefix ? (
                    <div className="text-sm text-gray-400">
                      Channel will be created as: <span className="font-mono text-blue-400">{getFullChannelName() || `${channelPrefix}-`}</span>
                    </div>
                  ) : null}
                  
                  <div className="relative">
                    {channelPrefix && (
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-sm pointer-events-none">
                        {channelPrefix}-
                      </div>
                    )}
                    <Input
                      placeholder="couple-chat, mason-chat, etc."
                      value={formData.channelName}
                      onChange={(e) => {
                        const sanitized = sanitizeChannelName(e.target.value)
                        setFormData(prev => ({ ...prev, channelName: sanitized }))
                      }}
                      className={`bg-gray-700 border-gray-600 text-white placeholder-gray-400 ${
                        channelPrefix ? 'pl-20' : ''
                      }`}
                      style={{ paddingLeft: channelPrefix ? `${channelPrefix.length * 8 + 24}px` : undefined }}
                    />
                  </div>
                  
                  <div className="text-xs text-gray-500">
                    Only lowercase letters, numbers, and hyphens allowed. Spaces will be converted to hyphens.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Channel Messages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Day Message (Optional)</label>
                <Textarea
                  placeholder="Message sent to this channel when day begins..."
                  value={formData.dayMessage}
                  onChange={(e) => setFormData(prev => ({ ...prev, dayMessage: e.target.value }))}
                  rows={3}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Night Message (Optional)</label>
                <Textarea
                  placeholder="Message sent to this channel when night begins..."
                  value={formData.nightMessage}
                  onChange={(e) => setFormData(prev => ({ ...prev, nightMessage: e.target.value }))}
                  rows={3}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Channel Behavior</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="open-dawn"
                    checked={formData.openAtDawn}
                    onCheckedChange={(checked) => 
                      setFormData(prev => ({ ...prev, openAtDawn: checked as boolean }))
                    }
                  />
                  <label htmlFor="open-dawn" className="text-sm font-medium text-gray-300">
                    Open at Day
                  </label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="open-dusk"
                    checked={formData.openAtDusk}
                    onCheckedChange={(checked) => 
                      setFormData(prev => ({ ...prev, openAtDusk: checked as boolean }))
                    }
                  />
                  <label htmlFor="open-dusk" className="text-sm font-medium text-gray-300">
                    Open at Night
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-end gap-2 p-6 border-t border-gray-700">
          <Button variant="outline" onClick={handleClose} className="border-gray-600 text-black hover:bg-gray-800 hover:text-white">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
            <Save className="w-4 h-4 mr-2" />
            {loading ? "Adding..." : "Add Channel"}
          </Button>
        </div>
      </div>
    </div>
  )
} 