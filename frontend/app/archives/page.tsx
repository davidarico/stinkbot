'use client'

import { useState, useEffect, useRef } from 'react'
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

  const areFiltersSet = () => filters.query !== '' && filters.user !== 'all'

  const [results, setResults] = useState<SearchResult[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState<Array<{ key: string; count: number }>>([])
  const [channels, setChannels] = useState<Array<{ key: string; count: number }>>([])
  const [users, setUsers] = useState<Array<{ key: string; count: number }>>([])
  const [jumpToMessage, setJumpToMessage] = useState<SearchResult | null>(null)
  const jumpToMessageRef = useRef<SearchResult | null>(null)
  const [replyPreviews, setReplyPreviews] = useState<Map<string, { content: string; username: string }>>(new Map())
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())

  const ITEMS_PER_PAGE = 20

  useEffect(() => { loadAggregations() }, [])
  useEffect(() => { searchMessages() }, [filters])

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
      if (jumpToMessageRef.current) {
        params.append('jumpToMessageId', jumpToMessageRef.current._source.messageId)
      }
      const response = await fetch(`/api/archives/search?${params}`)
      const data: SearchResponse = await response.json()
      setResults(data.hits.hits)
      setTotalHits(data.hits.total.value)
      await fetchReplyPreviews(data.hits.hits)
    } catch (error) {
      console.error('Error searching messages:', error)
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
              ? originalContent.length > 100 ? originalContent.substring(0, 100) + '…' : originalContent
              : '[No text content]'
            newPreviews.set(message._id, {
              content: preview,
              username: data.message._source.displayName || data.message._source.username
            })
          }
        } catch {
          newPreviews.set(message._id, { content: '[Original message not found]', username: 'Unknown' })
        }
      }
    }
    setReplyPreviews(newPreviews)
  }

  const handleJumpToRepliedMessage = async (message: SearchResult) => {
    const targetIndex = results.findIndex(r => r._source.messageId === message._source.replyToMessageId)
    if (targetIndex !== -1) {
      setTimeout(() => {
        const el = document.getElementById(`message-${message._source.replyToMessageId}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('ring-2', 'ring-primary', 'ring-opacity-50')
          setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-opacity-50'), 3000)
        }
      }, 100)
    } else {
      const response = await fetch(`/api/archives/message/${message._source.replyToMessageId}`)
      const data = await response.json()
      if (data.message) await handleJumpToMessage(data.message)
    }
  }

  const handleJumpToMessage = async (message: SearchResult) => {
    try {
      const params = new URLSearchParams({
        query: '', game: '', channel: message._source.channelName, user: '',
        page: '1', size: ITEMS_PER_PAGE.toString(),
        jumpToMessageId: message._source.messageId
      })
      const response = await fetch(`/api/archives/search?${params}`)
      const data: SearchResponse = await response.json()
      setFilters({ query: '', game: 'all', channel: message._source.channelName, user: 'all', page: data.targetPage || 1 })
    } catch {
      setFilters({ query: '', game: 'all', channel: message._source.channelName, user: 'all', page: 1 })
    }
  }

  const handleFilterChange = (key: keyof SearchFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }))
    setReplyPreviews(new Map())
  }

  const handlePageChange = (newPage: number) => setFilters(prev => ({ ...prev, page: newPage }))

  const totalPages = Math.ceil(totalHits / ITEMS_PER_PAGE)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2">
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </Button>
            </Link>
            <div className="h-4 w-px bg-border" />
            <h1 className="text-sm font-semibold text-foreground">Message Archives</h1>
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
                  value={filters.query}
                  onChange={(e) => handleFilterChange('query', e.target.value)}
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
              {results.map((result) => (
                <Card
                  key={result._id}
                  id={`message-${result._source.messageId}`}
                  className="bg-card border-border hover:border-border/80 transition-colors"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-7 w-7 shrink-0">
                        {result._source.profilePictureLink && !brokenImages.has(result._source.userId) ? (
                          <img
                            src={result._source.profilePictureLink}
                            alt=""
                            className="h-7 w-7 rounded-full object-cover"
                            onError={() => setBrokenImages(prev => new Set(prev).add(result._source.userId))}
                          />
                        ) : (
                          <AvatarFallback className="bg-secondary text-foreground text-xs">
                            {result._source.displayName?.charAt(0) || '?'}
                          </AvatarFallback>
                        )}
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-medium text-foreground">
                            {result._source.displayName || result._source.username}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {format(new Date(result._source.timestamp), 'MMM d, yyyy HH:mm')}
                          </span>
                          {result._source.replyToMessageId && (
                            <Badge className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                              <Reply className="h-2 w-2 mr-0.5" />
                              Reply
                            </Badge>
                          )}
                        </div>

                        {result._source.replyToMessageId && (
                          <div className="mb-2 px-2.5 py-1.5 bg-secondary/60 border-l-2 border-emerald-500/50 rounded-r text-xs text-muted-foreground">
                            <span className="text-emerald-400 font-medium">
                              {replyPreviews.get(result._id)?.username || '…'}
                            </span>
                            <span className="ml-1">
                              {replyPreviews.get(result._id)?.content || 'Loading…'}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 mb-2">
                          <Hash className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                          <span className="text-xs text-muted-foreground">{result._source.channelName}</span>
                          {result._source.category && (
                            <Badge className="text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground border-border">
                              {result._source.category}
                            </Badge>
                          )}
                        </div>

                        <div className="text-sm text-foreground/80 leading-relaxed mb-2">
                          {result._source.content || (
                            result._source.attachments?.some((a: any) => {
                              const ext = a.url?.split('.').pop()?.toLowerCase()
                              return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')
                            }) ? null : (
                              <span className="text-muted-foreground/50 italic text-xs">No text content</span>
                            )
                          )}
                        </div>

                        {result._source.content && extractMediaFromContent(result._source.content).length > 0 && (
                          <MediaDisplay media={extractMediaFromContent(result._source.content)} className="mt-2" />
                        )}

                        {result._source.attachments?.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {result._source.attachments
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
                            onClick={() => handleJumpToMessage(result)}
                          >
                            Jump to original
                          </button>
                        )}
                        {result._source.replyToMessageId && (
                          <button
                            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium flex items-center gap-1"
                            onClick={() => handleJumpToRepliedMessage(result)}
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
