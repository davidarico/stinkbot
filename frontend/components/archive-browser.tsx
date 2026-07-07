'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ChevronLeft, ChevronRight, Search, MessageSquare, Hash, Reply, ArrowLeft } from 'lucide-react'
import { format } from 'date-fns'
import { extractMediaFromContent } from '@/lib/media-utils'
import { MediaDisplay } from '@/components/MediaDisplay'
import Link from 'next/link'

interface ArchiveMessage {
  id: string
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
  replyPreview?: {
    content: string
    userId: string | null
    displayName: string
  }
  attachments: any[]
  embeds: any[]
  reactions: any[]
}

interface SearchFilters {
  query: string
  game: string
  channel: string
  user: string
  page: number
}

interface SearchResponse {
  messages: ArchiveMessage[]
  total: number
  targetPage?: number | null
}

const SEARCH_DEBOUNCE_MS = 300

interface ArchiveBrowserProps {
  apiBase: string
  title: string
  backHref: string
}

export function ArchiveBrowser({ apiBase, title, backHref }: ArchiveBrowserProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    game: 'all',
    channel: 'all',
    user: 'all',
    page: 1
  })
  const [queryInput, setQueryInput] = useState('')

  const areFiltersSet = () => filters.query !== '' && filters.user !== 'all'

  const [results, setResults] = useState<ArchiveMessage[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState<Array<{ key: string; count: number }>>([])
  const [channels, setChannels] = useState<Array<{ key: string; count: number }>>([])
  const [users, setUsers] = useState<Array<{ key: string; count: number }>>([])
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())

  const ITEMS_PER_PAGE = 20

  useEffect(() => { loadAggregations() }, [])
  useEffect(() => { searchMessages() }, [filters])

  // Debounce free-text query so we don't search on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => prev.query === queryInput ? prev : { ...prev, query: queryInput, page: 1 })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [queryInput])

  const loadAggregations = async () => {
    try {
      const response = await fetch(`${apiBase}/aggregations`)
      const data = await response.json()
      setGames(data.games || [])
      setChannels(data.channels || [])
      setUsers(data.users || [])
    } catch (error) {
      console.error('Error loading aggregations:', error)
    }
  }

  const searchMessages = async () => {
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
      const response = await fetch(`${apiBase}/search?${params}`)
      const data: SearchResponse = await response.json()
      setResults(data.messages)
      setTotalHits(data.total)
    } catch (error) {
      console.error('Error searching messages:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleJumpToRepliedMessage = async (message: ArchiveMessage) => {
    const targetIndex = results.findIndex(r => r.messageId === message.replyToMessageId)
    if (targetIndex !== -1) {
      setTimeout(() => {
        const el = document.getElementById(`message-${message.replyToMessageId}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('ring-2', 'ring-primary', 'ring-opacity-50')
          setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-opacity-50'), 3000)
        }
      }, 100)
    } else {
      const response = await fetch(`/api/archives/message/${message.replyToMessageId}`)
      const data = await response.json()
      if (data.message) await handleJumpToMessage(data.message)
    }
  }

  const handleJumpToMessage = async (message: ArchiveMessage) => {
    try {
      const params = new URLSearchParams({
        query: '', game: '', channel: message.channelName, user: '',
        page: '1', size: ITEMS_PER_PAGE.toString(),
        jumpToMessageId: message.messageId
      })
      const response = await fetch(`${apiBase}/search?${params}`)
      const data: SearchResponse = await response.json()
      setQueryInput('')
      setFilters({ query: '', game: 'all', channel: message.channelName, user: 'all', page: data.targetPage || 1 })
    } catch {
      setQueryInput('')
      setFilters({ query: '', game: 'all', channel: message.channelName, user: 'all', page: 1 })
    }
  }

  const handleFilterChange = (key: keyof SearchFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }))
  }

  const handlePageChange = (newPage: number) => setFilters(prev => ({ ...prev, page: newPage }))

  const totalPages = Math.ceil(totalHits / ITEMS_PER_PAGE)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={backHref}>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2">
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </Button>
            </Link>
            <div className="h-4 w-px bg-border" />
            <h1 className="text-sm font-semibold text-foreground">{title}</h1>
          </div>
          {totalHits > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalHits.toLocaleString()} messages
            </span>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Filters */}
        <Card className="mb-6 bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              Search
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="query" className="text-xs text-muted-foreground">Query</Label>
                <Input
                  id="query"
                  placeholder="Search content…"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Game</Label>
                <Select value={filters.game} onValueChange={(v) => handleFilterChange('game', v)}>
                  <SelectTrigger className="bg-background border-border text-foreground h-8 text-sm">
                    <SelectValue placeholder="All games" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all" className="text-sm">All games</SelectItem>
                    {games.map((g) => (
                      <SelectItem key={g.key} value={g.key} className="text-sm">{g.key}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Channel</Label>
                <Select value={filters.channel} onValueChange={(v) => handleFilterChange('channel', v)}>
                  <SelectTrigger className="bg-background border-border text-foreground h-8 text-sm">
                    <SelectValue placeholder="All channels" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all" className="text-sm">All channels</SelectItem>
                    {channels.map((c) => (
                      <SelectItem key={c.key} value={c.key} className="text-sm">#{c.key}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">User</Label>
                <Select value={filters.user} onValueChange={(v) => handleFilterChange('user', v)}>
                  <SelectTrigger className="bg-background border-border text-foreground h-8 text-sm">
                    <SelectValue placeholder="All users" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all" className="text-sm">All users</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.key} value={u.key} className="text-sm">{u.key}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <span className="text-sm">Searching…</span>
          </div>
        ) : (
          <>
            {results.length > 0 && (
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {filters.page} of {totalPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                    onClick={() => handlePageChange(filters.page - 1)} disabled={filters.page <= 1}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                    onClick={() => handlePageChange(filters.page + 1)} disabled={filters.page >= totalPages}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {results.map((message) => (
                <Card
                  key={message.id}
                  id={`message-${message.messageId}`}
                  className="bg-card border-border hover:border-border/80 transition-colors"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-7 w-7 shrink-0">
                        {message.profilePictureLink && !brokenImages.has(message.userId) ? (
                          <img
                            src={message.profilePictureLink}
                            alt=""
                            className="h-7 w-7 rounded-full object-cover"
                            onError={() => setBrokenImages(prev => new Set(prev).add(message.userId))}
                          />
                        ) : (
                          <AvatarFallback className="bg-secondary text-foreground text-xs">
                            {message.displayName?.charAt(0) || '?'}
                          </AvatarFallback>
                        )}
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-medium text-foreground">
                            {message.displayName || message.username}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {format(new Date(message.timestamp), 'MMM d, yyyy HH:mm')}
                          </span>
                          {message.replyToMessageId && (
                            <Badge className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                              <Reply className="h-2 w-2 mr-0.5" />
                              Reply
                            </Badge>
                          )}
                        </div>

                        {message.replyToMessageId && message.replyPreview && (
                          <div className="mb-2 px-2.5 py-1.5 bg-secondary/60 border-l-2 border-emerald-500/50 rounded-r text-xs text-muted-foreground">
                            <span className="text-emerald-400 font-medium">
                              {message.replyPreview.displayName}
                            </span>
                            <span className="ml-1">
                              {message.replyPreview.content}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 mb-2">
                          <Hash className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                          <span className="text-xs text-muted-foreground">{message.channelName}</span>
                          {message.category && (
                            <Badge className="text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground border-border">
                              {message.category}
                            </Badge>
                          )}
                        </div>

                        <div className="text-[0.9375rem] text-foreground/95 leading-relaxed mb-2">
                          {message.content || (
                            message.attachments?.some((a: any) => {
                              const ext = a.url?.split('.').pop()?.toLowerCase()
                              return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')
                            }) ? null : (
                              <span className="text-muted-foreground/50 italic text-xs">No text content</span>
                            )
                          )}
                        </div>

                        {message.content && extractMediaFromContent(message.content).length > 0 && (
                          <MediaDisplay media={extractMediaFromContent(message.content)} className="mt-2" />
                        )}

                        {message.attachments?.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {message.attachments
                              .filter((a: any) => {
                                const ext = a.url?.split('.').pop()?.toLowerCase()
                                return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')
                              })
                              .map((a: any, i: number) => {
                                const isGif = a.url?.split('.').pop()?.toLowerCase() === 'gif'
                                return (
                                  <div key={i} className="relative group inline-block">
                                    <img src={a.url} alt={a.filename || 'Image'}
                                      className="rounded max-w-full max-h-80 object-contain" />
                                    {isGif && (
                                      <span className="absolute top-1.5 right-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                                        GIF
                                      </span>
                                    )}
                                  </div>
                                )
                              })}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex flex-col gap-1.5 items-end">
                        {areFiltersSet() && (
                          <button
                            className="text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                            onClick={() => handleJumpToMessage(message)}
                          >
                            Jump to original
                          </button>
                        )}
                        {message.replyToMessageId && (
                          <button
                            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium flex items-center gap-1"
                            onClick={() => handleJumpToRepliedMessage(message)}
                          >
                            <Reply className="h-3 w-3" />
                            Jump to reply
                          </button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {results.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No messages match your criteria.</p>
              </div>
            )}

            {results.length > 0 && totalPages > 1 && (
              <div className="flex justify-center items-center gap-3 mt-8 pt-6 border-t border-border/60">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                  onClick={() => handlePageChange(filters.page - 1)} disabled={filters.page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {filters.page} / {totalPages}
                </span>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                  onClick={() => handlePageChange(filters.page + 1)} disabled={filters.page >= totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
