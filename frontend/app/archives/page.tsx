'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ChevronLeft, ChevronRight, Search, MessageSquare, Hash, Reply } from 'lucide-react'
import { format } from 'date-fns'
import { extractMediaFromContent } from '@/lib/media-utils'
import { MediaDisplay } from '@/components/MediaDisplay'

interface SearchResult {
  _id: string
  _source: {
    messageId: string
    content: string
    userId: string
    username: string
    displayName: string
    profilePictureLink?: string
    timestamp: string
    channelId: string
    channelName: string
    category: string
    categoryId: string
    replyToMessageId?: string
    attachments: any[]
    embeds: any[]
    reactions: any[]
  }
}

interface SearchFilters {
  query: string
  game: string
  channel: string
  user: string
  page: number
}

interface SearchResponse {
  hits: {
    total: { value: number }
    hits: SearchResult[]
  }
  aggregations?: {
    games?: { buckets: Array<{ key: string; doc_count: number }> }
    channels?: { buckets: Array<{ key: string; doc_count: number }> }
    users?: { buckets: Array<{ key: string; doc_count: number }> }
  }
  targetPage?: number | null
}

export default function ArchivesPage() {
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    game: 'all',
    channel: 'all',
    user: 'all',
    page: 1
  })

  const areFiltersSet = () => {
    return filters.query !== '' && filters.user !== 'all'
  }

  const [results, setResults] = useState<SearchResult[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState<Array<{ key: string; count: number }>>([])
  const [channels, setChannels] = useState<Array<{ key: string; count: number }>>([])
  const [users, setUsers] = useState<Array<{ key: string; count: number }>>([])
  const [jumpToMessage, setJumpToMessage] = useState<SearchResult | null>(null)
  const jumpToMessageRef = useRef<SearchResult | null>(null)
  const [replyPreviews, setReplyPreviews] = useState<Map<string, { content: string; username: string }>>(new Map())

  const ITEMS_PER_PAGE = 20

  useEffect(() => {
    loadAggregations()
  }, [])

  useEffect(() => {
    searchMessages()
  }, [filters])

  const loadAggregations = async () => {
    try {
      const response = await fetch('/api/archives/aggregations')
      const data = await response.json()

      if (data.aggregations) {
        setGames(data.aggregations.games?.buckets || [])
        setChannels(data.aggregations.channels?.buckets || [])
        setUsers(data.aggregations.users?.buckets || [])
      }
    } catch (error) {
      console.error('Error loading aggregations:', error)
    }
  }

  const searchMessages = async () => {
    console.log('🔍 searchMessages called with filters:', filters)
    setLoading(true)
    try {
      const params = new URLSearchParams({
        query: filters.query,
        game: filters.game === 'all' ? '' : filters.game,
        channel: filters.channel === 'all' ? '' : filters.channel,
        user: filters.user === 'all' ? '' : filters.user,
        page: filters.page.toString(),
        size: ITEMS_PER_PAGE.toString()
      })

      // Add jump to message parameter if we're jumping to a specific message
      if (jumpToMessageRef.current) {
        params.append('jumpToMessageId', jumpToMessageRef.current._source.messageId)
        console.log('🎯 Adding jumpToMessageId:', jumpToMessageRef.current._source.messageId)
      }

      console.log('📡 Making search request with params:', params.toString())
      const response = await fetch(`/api/archives/search?${params}`)
      const data: SearchResponse = await response.json()

      console.log('📊 Search results:', {
        totalHits: data.hits.total.value,
        resultsCount: data.hits.hits.length,
        targetPage: data.targetPage
      })

      setResults(data.hits.hits)
      setTotalHits(data.hits.total.value)

      // Fetch reply previews for messages that are replies
      await fetchReplyPreviews(data.hits.hits)
    } catch (error) {
      console.error('❌ Error searching messages:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchReplyPreviews = async (messages: SearchResult[]) => {
    const newPreviews = new Map<string, { content: string; username: string }>()

    for (const message of messages) {
      if (message._source.replyToMessageId) {
        try {
          const response = await fetch(`/api/archives/message/${message._source.replyToMessageId}`)
          const data = await response.json()

          if (data.message) {
            const originalContent = data.message._source.content
            const preview = originalContent
              ? originalContent.length > 100
                ? originalContent.substring(0, 100) + '...'
                : originalContent
              : '[No text content]'
            const username = data.message._source.displayName || data.message._source.username
            newPreviews.set(message._id, { content: preview, username })
          }
        } catch (error) {
          console.error('Error fetching reply preview:', error)
          newPreviews.set(message._id, { content: '[Original message not found]', username: 'Unknown' })
        }
      }
    }

    setReplyPreviews(newPreviews)
  }

    // Scroll to target message when jumping to a specific message
    const handleJumpToRepliedMessage = (message: SearchResult) => {

      console.log('Attempting to scroll to message:', message._source.replyToMessageId)
      console.log('Current results count:', results.length)
  
      // Find the target message in the results
      // Use the Discord messageId instead of OpenSearch _id
      const targetIndex = results.findIndex(result => result._source.messageId === message._source.replyToMessageId)
      console.log('Target message found at index:', targetIndex)
  
      if (targetIndex !== -1) {
        console.log('Found target message, scrolling to it...')
        // Scroll to the message after a short delay to ensure DOM is ready
        setTimeout(() => {
          const messageElement = document.getElementById(`message-${message._source.replyToMessageId}`)
          if (messageElement) {
            console.log('Scrolling to message element')
            messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
            // Add a temporary highlight effect
            messageElement.classList.add('ring-2', 'ring-blue-500', 'ring-opacity-50')
            setTimeout(() => {
              messageElement.classList.remove('ring-2', 'ring-blue-500', 'ring-opacity-50')
            }, 3000)
          } else {
            console.log('Message element not found in DOM')
          }
        }, 100)
      } else {
        // Message not found in current results - this might happen if the page calculation was off
        console.log('Target message not found in current results')
        console.log('Available message IDs:', results.map(r => r._source.messageId).slice(0, 5))
  
        handleJumpToMessage(message)
      }
    }

  const handleJumpToMessage = async (message: SearchResult) => {
    console.log('Performing search for target message...')
    // Calculate the correct page first
    try {
      const params = new URLSearchParams({
        query: '',
        game: '',
        channel: message._source.channelName,
        user: '',
        page: '1',
        size: ITEMS_PER_PAGE.toString(),
        jumpToMessageId: message._source.messageId
      })

      console.log('📡 Search params:', params.toString())
      const response = await fetch(`/api/archives/search?${params}`)
      const data: SearchResponse = await response.json()

      console.log('📊 Search response:', {
        targetPage: data.targetPage,
        totalHits: data.hits.total.value,
        resultsCount: data.hits.hits.length
      })

      // Set filters with the correct page
      const newFilters = {
        query: '',
        game: 'all',
        channel: message._source.channelName,
        user: 'all',
        page: data.targetPage || 1
      }

      console.log('🎯 Setting new filters:', newFilters)
      setFilters(newFilters)
    } catch (error) {
      console.error('Error calculating target page:', error)
      // Fallback to page 1
      setFilters({
        query: '',
        game: 'all',
        channel: message._source.channelName,
        user: 'all',
        page: 1
      })
    }
  }
  
  const handleFilterChange = (key: keyof SearchFilters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1 // Reset to first page when filters change
    }))
    // Clear reply previews when filters change
    setReplyPreviews(new Map())
  }

  const handlePageChange = (newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }))
  }

  const totalPages = Math.ceil(totalHits / ITEMS_PER_PAGE)

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 text-white">Message Archives</h1>
          <p className="text-gray-300">
            Search through archived Discord messages from your Werewolf games
          </p>
        </div>

        {/* Search Filters */}
        <Card className="mb-6 bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Search className="h-5 w-5" />
              Search Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="query" className="text-white">Search Query</Label>
                <Input
                  id="query"
                  placeholder="Search message content..."
                  value={filters.query}
                  onChange={(e) => handleFilterChange('query', e.target.value)}
                  className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400 focus:border-blue-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="game" className="text-white">Game</Label>
                <Select value={filters.game} onValueChange={(value) => handleFilterChange('game', value)}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="All games" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-700 border-gray-600">
                    <SelectItem value="all" className="text-white hover:bg-gray-600">All games</SelectItem>
                    {games.map((game) => (
                      <SelectItem key={game.key} value={game.key} className="text-white hover:bg-gray-600">
                        {game.key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="channel" className="text-white">Channel</Label>
                <Select value={filters.channel} onValueChange={(value) => handleFilterChange('channel', value)}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="All channels" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-700 border-gray-600">
                    <SelectItem value="all" className="text-white hover:bg-gray-600">All channels</SelectItem>
                    {channels.map((channel) => (
                      <SelectItem key={channel.key} value={channel.key} className="text-white hover:bg-gray-600">
                        #{channel.key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="user" className="text-white">User</Label>
                <Select value={filters.user} onValueChange={(value) => handleFilterChange('user', value)}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="All users" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-700 border-gray-600">
                    <SelectItem value="all" className="text-white hover:bg-gray-600">All users</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.key} value={user.key} className="text-white hover:bg-gray-600">
                        {user.key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
              <p className="mt-2 text-gray-300">Searching messages...</p>
            </div>
          ) : (
            <>
              {results.length > 0 && (
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm text-gray-300">
                    Found {totalHits} messages
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                      onClick={() => handlePageChange(filters.page - 1)}
                      disabled={filters.page <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-300">
                      Page {filters.page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                      onClick={() => handlePageChange(filters.page + 1)}
                      disabled={filters.page >= totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {results.map((result) => (
                  <Card
                    key={result._id}
                    id={`message-${result._source.messageId}`}
                    className="hover:shadow-md transition-shadow bg-gray-800 border-gray-700"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-8 w-8">
                          {result._source.profilePictureLink ? (
                            <img
                              src={result._source.profilePictureLink}
                              alt={`${result._source.displayName || result._source.username}'s avatar`}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <AvatarFallback className="bg-gray-600 text-white">
                              {result._source.displayName?.charAt(0) || '?'}
                            </AvatarFallback>
                          )}
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm text-white">
                              {result._source.displayName || result._source.username}
                            </span>
                            <span className="text-xs text-gray-400">
                              {format(new Date(result._source.timestamp), 'MMM d, yyyy HH:mm')}
                            </span>
                            {/* Show reply indicator in the header */}
                            {result._source.replyToMessageId && (
                              <Badge variant="outline" className="text-xs border-green-600 text-green-400 bg-green-900/20">
                                <Reply className="h-2 w-2 mr-1" />
                                Reply
                              </Badge>
                            )}
                          </div>

                          {/* Show reply preview */}
                          {result._source.replyToMessageId && (
                            <div className="mb-2 p-2 bg-gray-700/50 border-l-2 border-green-500 rounded-r text-xs text-gray-300">
                              <div className="flex items-center gap-1 mb-1">
                                <Reply className="h-3 w-3 text-green-400" />
                                <span className="text-green-400 font-medium">Replying to:</span>
                              </div>
                              <div className="text-gray-300">
                                {(() => {
                                  const preview = replyPreviews.get(result._id)
                                  if (!preview) return 'Loading preview...'
                                  return (
                                    <>
                                      <span className="text-green-400 font-medium">{preview.username}</span>
                                      <span className="text-gray-400">: {preview.content}</span>
                                    </>
                                  )
                                })()}
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-2 mb-2">
                            <Hash className="h-3 w-3 text-gray-400" />
                            <span className="text-xs text-gray-400">
                              {result._source.channelName}
                            </span>
                            {result._source.category && (
                              <Badge variant="outline" className="text-xs border-gray-600 text-gray-300">
                                {result._source.category}
                              </Badge>
                            )}
                          </div>

                          <div className="text-sm mb-3 text-gray-200">
                            {result._source.content || (
                              (result._source.attachments && result._source.attachments.some((a: any) => {
                                if (!a.url) return false
                                const extension = a.url.split('.').pop()?.toLowerCase()
                                return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')
                              })) ?
                                null :
                                <span className="text-gray-400 italic">No text content</span>
                            )}
                          </div>

                          {/* Display media content */}
                          {result._source.content && extractMediaFromContent(result._source.content).length > 0 && (
                            <MediaDisplay
                              media={extractMediaFromContent(result._source.content)}
                              className="mt-3"
                            />
                          )}

                          {/* Display image attachments directly */}
                          {result._source.attachments && result._source.attachments.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {result._source.attachments
                                .filter((attachment: any) => {
                                  if (!attachment.url) return false
                                  const extension = attachment.url.split('.').pop()?.toLowerCase()
                                  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')
                                })
                                .map((attachment: any, index: number) => {
                                  const extension = attachment.url.split('.').pop()?.toLowerCase()
                                  const isGif = extension === 'gif'

                                  return (
                                    <div key={index} className="relative group">
                                      <img
                                        src={attachment.url}
                                        alt={attachment.filename || 'Image'}
                                        className="rounded-lg max-w-full max-h-96 object-contain cursor-pointer transition-all duration-200"
                                      />
                                      {isGif && (
                                        <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                                          GIF
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                            </div>
                          )}


                        </div>

                        <div className="flex-shrink-0 flex flex-col gap-2">
                          {areFiltersSet() && (
                            <button
                              className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
                              onClick={() => handleJumpToMessage(result)}
                            >
                              Jump to Original Message
                            </button>
                          )}
                          {/* Jump to Original button for reply messages */}
                          {result._source.replyToMessageId && (
                            <button
                              className="text-green-400 hover:text-green-300 text-sm font-medium transition-colors flex items-center gap-1"
                              onClick={() => handleJumpToRepliedMessage(result)}
                            >
                              <Reply className="h-3 w-3" />
                              Jump to Replied Message
                            </button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {results.length === 0 && !loading && (
                <div className="text-center py-8">
                  <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-400">No messages found matching your search criteria</p>
                </div>
              )}

              {/* Bottom Pagination */}
              {results.length > 0 && totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 mt-8 py-4 border-t border-gray-700">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    onClick={() => handlePageChange(filters.page - 1)}
                    disabled={filters.page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  <span className="text-sm text-gray-300">
                    Page {filters.page} of {totalPages}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    onClick={() => handlePageChange(filters.page + 1)}
                    disabled={filters.page >= totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>


      </div>
    </div>
  )
}
