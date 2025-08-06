"use client"

import { useState } from "react"
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
  const [formData, setFormData] = useState({
    channelName: "",
    dayMessage: "",
    nightMessage: "",
    openAtDawn: true,
    openAtDusk: true
  })

  const handleSave = async () => {
    if (!formData.channelName.trim()) {
      toast({
        title: "Validation Error",
        description: "Channel name is required.",
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
          channelName: formData.channelName.trim(),
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
                <Input
                  placeholder="e.g., Couple Chat, Mason Chat..."
                  value={formData.channelName}
                  onChange={(e) => setFormData(prev => ({ ...prev, channelName: e.target.value }))}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
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