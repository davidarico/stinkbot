"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { Settings, Save, X } from "lucide-react"

interface GameChannel {
  id: number
  channel_id: string
  channel_name: string
  day_message?: string
  night_message?: string
  open_at_dawn: boolean
  open_at_dusk: boolean
}

interface GameSettings {
  dayMessage?: string
  nightMessage?: string
  wolfDayMessage?: string
  wolfNightMessage?: string
  votesToHang?: number
  gameChannels?: GameChannel[]
}

interface SettingsModalProps {
  gameId: string
  isOpen: boolean
  onClose: () => void
  initialSettings?: GameSettings
}

export function SettingsModal({ gameId, isOpen, onClose, initialSettings }: SettingsModalProps) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<GameSettings>({
    dayMessage: "",
    nightMessage: "",
    wolfDayMessage: "",
    wolfNightMessage: "",
    votesToHang: 4,
    gameChannels: []
  })
  const [loading, setLoading] = useState(false)
  const [channelsLoading, setChannelsLoading] = useState(false)

  useEffect(() => {
    if (isOpen && initialSettings) {
      setSettings(initialSettings)
    }
  }, [isOpen, initialSettings])

  useEffect(() => {
    if (isOpen) {
      loadGameChannels()
    }
  }, [isOpen])

  const loadGameChannels = async () => {
    try {
      setChannelsLoading(true)
      const response = await fetch(`/api/games/${gameId}/channels`)
      if (response.ok) {
        const channels = await response.json()
        setSettings(prev => ({
          ...prev,
          gameChannels: channels
        }))
      }
    } catch (error) {
      console.error('Error loading game channels:', error)
    } finally {
      setChannelsLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/games/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateSettings',
          settings
        })
      })

      if (response.ok) {
        toast({
          title: "Settings Saved",
          description: "Game settings have been updated successfully.",
        })
        onClose()
      } else {
        const error = await response.json()
        toast({
          title: "Save Failed",
          description: error.error || "Failed to save settings",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error('Error saving settings:', error)
      toast({
        title: "Save Error",
        description: "Error saving settings",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const updateChannelSetting = (channelId: number, field: keyof GameChannel, value: any) => {
    setSettings(prev => ({
      ...prev,
      gameChannels: prev.gameChannels?.map(channel => 
        channel.id === channelId ? { ...channel, [field]: value } : channel
      ) || []
    }))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-white" />
            <h2 className="text-xl font-semibold text-white">Game Settings</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-300 hover:text-white hover:bg-gray-800">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Game Configuration */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Game Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Votes to Hang</label>
                <Input
                  type="number"
                  min="1"
                  max="20"
                  placeholder="Number of votes needed to hang a player..."
                  value={settings.votesToHang || 4}
                  onChange={(e) => setSettings(prev => ({ ...prev, votesToHang: parseInt(e.target.value) || 4 }))}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
            </CardContent>
          </Card>

          {/* Main Game Messages */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Main Game Messages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Day Message</label>
                <Textarea
                  placeholder="Message sent when day begins..."
                  value={settings.dayMessage || ""}
                  onChange={(e) => setSettings(prev => ({ ...prev, dayMessage: e.target.value }))}
                  rows={3}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Night Message</label>
                <Textarea
                  placeholder="Message sent when night begins..."
                  value={settings.nightMessage || ""}
                  onChange={(e) => setSettings(prev => ({ ...prev, nightMessage: e.target.value }))}
                  rows={3}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
            </CardContent>
          </Card>

          {/* Wolf Chat Messages */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Wolf Chat Messages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Wolf Day Message</label>
                <Textarea
                  placeholder="Message sent to wolf chat when day begins..."
                  value={settings.wolfDayMessage || ""}
                  onChange={(e) => setSettings(prev => ({ ...prev, wolfDayMessage: e.target.value }))}
                  rows={3}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Wolf Night Message</label>
                <Textarea
                  placeholder="Message sent to wolf chat when night begins..."
                  value={settings.wolfNightMessage || ""}
                  onChange={(e) => setSettings(prev => ({ ...prev, wolfNightMessage: e.target.value }))}
                  rows={3}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
            </CardContent>
          </Card>

          {/* Game Channels */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Game Channels</CardTitle>
              {channelsLoading && (
                <p className="text-sm text-gray-500">Loading channels...</p>
              )}
            </CardHeader>
            <CardContent>
              {settings.gameChannels && settings.gameChannels.length > 0 ? (
                <div className="space-y-4">
                  {settings.gameChannels.map((channel) => (
                    <div key={channel.id} className="border border-gray-600 rounded-lg p-4 space-y-4 bg-gray-700">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-white">{channel.channel_name}</h4>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-300">Day Message</label>
                          <Textarea
                            placeholder="Channel-specific day message..."
                            value={channel.day_message || ""}
                            onChange={(e) => updateChannelSetting(channel.id, 'day_message', e.target.value)}
                            rows={2}
                            className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-300">Night Message</label>
                          <Textarea
                            placeholder="Channel-specific night message..."
                            value={channel.night_message || ""}
                            onChange={(e) => updateChannelSetting(channel.id, 'night_message', e.target.value)}
                            rows={2}
                            className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
                          />
                        </div>
                      </div>

                      <Separator className="bg-gray-600" />

                      <div className="flex items-center gap-6">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`open-dawn-${channel.id}`}
                            checked={channel.open_at_dawn}
                            onCheckedChange={(checked) => 
                              updateChannelSetting(channel.id, 'open_at_dawn', checked === true)
                            }
                          />
                          <label htmlFor={`open-dawn-${channel.id}`} className="text-sm font-medium text-gray-300">
                            Open at Day
                          </label>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`open-dusk-${channel.id}`}
                            checked={channel.open_at_dusk}
                            onCheckedChange={(checked) => 
                              updateChannelSetting(channel.id, 'open_at_dusk', checked === true)
                            }
                          />
                          <label htmlFor={`open-dusk-${channel.id}`} className="text-sm font-medium text-gray-300">
                            Open at Night
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">
                  No additional game channels found.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-end gap-2 p-6 border-t border-gray-700">
          <Button variant="outline" onClick={onClose} className="border-gray-600 text-black hover:bg-gray-800 hover:text-white">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
            <Save className="w-4 h-4 mr-2" />
            {loading ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  )
} 