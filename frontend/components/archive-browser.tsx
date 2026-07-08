'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Hash, Menu,
  MessageSquare, Reply, Search, X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { extractMediaFromContent } from '@/lib/media-utils'
import { MediaDisplay } from '@/components/MediaDisplay'

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

interface NavChannel {
  channelId: string
  channelName: string
  messageCount: number
}

interface NavCategory {
  categoryId: string
  category: string
  channels: NavChannel[]
}

interface SelectedChannel {
  channelId: string
  channelName: string
  categoryId: string
  category: string
}

interface SearchResponse {
  messages: ArchiveMessage[]
  total: number
  targetPage?: number | null
}

const SEARCH_DEBOUNCE_MS = 300
const CHANNEL_PAGE_SIZE = 50
const SEARCH_PAGE_SIZE = 20

interface ArchiveBrowserProps {
  apiBase: string
  title: string
  backHref: string
}

export function ArchiveBrowser({ apiBase, title, backHref }: ArchiveBrowserProps) {
  const [navigation, setNavigation] = useState<NavCategory[]>([])
  const [navLoading, setNavLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<SelectedChannel | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const [results, setResults] = useState<ArchiveMessage[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [loading, setLoading] = useState(false)
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())

  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingHighlightRef = useRef<string | null>(null)

  const isSearch = query.trim() !== ''
  const pageSize = isSearch ? SEARCH_PAGE_SIZE : CHANNEL_PAGE_SIZE
  const totalPages = Math.ceil(totalHits / pageSize)

  // Load the category → channel tree; land on the newest category's
  // alphabetically-first channel.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(`${apiBase}/navigation`)
        const data = await response.json()
        const categories: NavCategory[] = data.categories || []
        if (cancelled) return
        setNavigation(categories)
        const first = categories[0]
        if (first) {
          setExpanded(new Set([first.categoryId]))
          const channel = first.channels[0]
          if (channel) {
            setSelected({
              channelId: channel.channelId,
              channelName: channel.channelName,
              categoryId: first.categoryId,
              category: first.category
            })
          }
        }
      } catch (error) {
        console.error('Error loading navigation:', error)
      } finally {
        if (!cancelled) setNavLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [apiBase])

  // Debounce free-text query so we don't search on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== queryInput) {
        setQuery(queryInput)
        setPage(1)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [queryInput, query])

  useEffect(() => {
    const searching = query.trim() !== ''
    if (!searching && !selected) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          query: searching ? query : '',
          channelId: searching ? '' : selected!.channelId,
          page: page.toString(),
          size: (searching ? SEARCH_PAGE_SIZE : CHANNEL_PAGE_SIZE).toString()
        })
        const response = await fetch(`${apiBase}/search?${params}`)
        const data: SearchResponse = await response.json()
        if (cancelled) return
        setResults(data.messages || [])
        setTotalHits(data.total || 0)
      } catch (error) {
        console.error('Error loading messages:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [apiBase, query, page, selected])

  // After a page renders: jump targets scroll into view with a highlight;
  // otherwise channel pages land at the bottom (newest), search at the top.
  useEffect(() => {
    if (loading) return
    const container = scrollRef.current
    if (!container) return
    const highlightId = pendingHighlightRef.current
    requestAnimationFrame(() => {
      if (highlightId) {
        pendingHighlightRef.current = null
        const el = document.getElementById(`message-${highlightId}`)
        if (el) {
          el.scrollIntoView({ block: 'center' })
          el.classList.add('ring-2', 'ring-primary', 'ring-opacity-50')
          setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-opacity-50'), 3000)
          return
        }
      }
      container.scrollTop = query.trim() === '' ? container.scrollHeight : 0
    })
  }, [results, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the mobile flyout
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  const toggleCategory = (categoryId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const selectChannel = (category: NavCategory, channel: NavChannel) => {
    pendingHighlightRef.current = null
    setSelected({
      channelId: channel.channelId,
      channelName: channel.channelName,
      categoryId: category.categoryId,
      category: category.category
    })
    setQueryInput('')
    setQuery('')
    setPage(1)
    setSidebarOpen(false)
  }

  const clearSearch = () => {
    setQueryInput('')
    setQuery('')
    setPage(1)
  }

  const handleJumpToMessage = async (message: ArchiveMessage) => {
    let targetPage = 1
    try {
      const params = new URLSearchParams({
        query: '',
        channelId: message.channelId,
        page: '1',
        size: CHANNEL_PAGE_SIZE.toString(),
        jumpToMessageId: message.messageId
      })
      const response = await fetch(`${apiBase}/search?${params}`)
      const data: SearchResponse = await response.json()
      targetPage = data.targetPage || 1
    } catch {
      // fall back to the newest page of the channel
    }
    pendingHighlightRef.current = message.messageId
    setSelected({
      channelId: message.channelId,
      channelName: message.channelName,
      categoryId: message.categoryId,
      category: message.category
    })
    setExpanded(prev => {
      if (prev.has(message.categoryId)) return prev
      const next = new Set(prev)
      next.add(message.categoryId)
      return next
    })
    setQueryInput('')
    setQuery('')
    setPage(targetPage)
  }

  const handleJumpToRepliedMessage = async (message: ArchiveMessage) => {
    const inPage = results.some(r => r.messageId === message.replyToMessageId)
    if (inPage) {
      const el = document.getElementById(`message-${message.replyToMessageId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-2', 'ring-primary', 'ring-opacity-50')
        setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-opacity-50'), 3000)
      }
      return
    }
    const response = await fetch(`/api/archives/message/${message.replyToMessageId}`)
    const data = await response.json()
    if (data.message) await handleJumpToMessage(data.message)
  }

  // Channel pages read top-to-bottom chronologically (API returns newest first)
  const displayMessages = isSearch ? results : [...results].reverse()

  const renderMessage = (message: ArchiveMessage) => {
    const media = message.content ? extractMediaFromContent(message.content) : []
    const imageAttachments = (message.attachments || []).filter((a: any) => {
      const ext = a.url?.split('.').pop()?.toLowerCase()
      return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')
    })

    return (
      <div
        key={message.id}
        id={`message-${message.messageId}`}
        className={cn(
          'group rounded-md transition-colors',
          isSearch
            ? 'bg-card/60 border border-border/60 px-3 py-2.5'
            : 'px-3 py-1.5 hover:bg-accent/30'
        )}
      >
        {isSearch && (
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <button
              onClick={() => handleJumpToMessage(message)}
              className="flex items-center gap-1 min-w-0 text-xs text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Hash className="h-3 w-3 shrink-0" />
              <span className="truncate">{message.channelName}</span>
              <span className="text-muted-foreground/50 shrink-0">·</span>
              <span className="truncate">{message.category}</span>
            </button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs shrink-0 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 transition-opacity"
              onClick={() => handleJumpToMessage(message)}
            >
              Jump
            </Button>
          </div>
        )}

        <div className="flex items-start gap-3">
          <Avatar className="h-8 w-8 shrink-0 mt-0.5">
            {message.profilePictureLink && !brokenImages.has(message.userId) ? (
              <img
                src={message.profilePictureLink}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
                onError={() => setBrokenImages(prev => new Set(prev).add(message.userId))}
              />
            ) : (
              <AvatarFallback className="bg-secondary text-foreground text-xs">
                {message.displayName?.charAt(0) || '?'}
              </AvatarFallback>
            )}
          </Avatar>

          <div className="flex-1 min-w-0">
            {message.replyToMessageId && message.replyPreview && (
              <button
                onClick={() => handleJumpToRepliedMessage(message)}
                className="mb-0.5 flex items-center gap-1.5 max-w-full text-xs text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Reply className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span className="font-medium text-foreground/80 shrink-0">
                  {message.replyPreview.displayName}
                </span>
                <span className="truncate">{message.replyPreview.content}</span>
              </button>
            )}

            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">
                {message.displayName || message.username}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {format(new Date(message.timestamp), 'MMM d, yyyy HH:mm')}
              </span>
            </div>

            {message.content ? (
              <div className="text-[0.9375rem] text-foreground/95 leading-relaxed break-words">
                {message.content}
              </div>
            ) : imageAttachments.length === 0 ? (
              <div className="text-muted-foreground/50 italic text-xs">No text content</div>
            ) : null}

            {media.length > 0 && <MediaDisplay media={media} className="mt-1.5" />}

            {imageAttachments.length > 0 && (
              <div className="mt-1.5 space-y-2">
                {imageAttachments.map((a: any, i: number) => {
                  const isGif = a.url?.split('.').pop()?.toLowerCase() === 'gif'
                  return (
                    <div key={i} className="relative inline-block">
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
        </div>
      </div>
    )
  }

  return (
    <div className="h-dvh flex bg-background text-foreground overflow-hidden">
      {/* Mobile flyout backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: fixed flyout on mobile, static rail on md+ */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar border-r border-sidebar-border',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'md:static md:z-auto md:w-60 md:shrink-0 md:translate-x-0'
        )}
      >
        <div className="h-12 shrink-0 flex items-center gap-1.5 px-3 border-b border-sidebar-border">
          <Link href={backHref} aria-label="Back">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 -ml-1 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-sm font-semibold truncate flex-1">{title}</h1>
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0 md:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close channel list"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Categories and channels">
          {navLoading ? (
            <div className="space-y-2 px-1.5 pt-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={cn('h-4 rounded bg-accent/60 animate-pulse', i % 4 === 0 ? 'w-2/3' : 'w-5/6 ml-3')} />
              ))}
            </div>
          ) : navigation.length === 0 ? (
            <p className="px-1.5 pt-1 text-xs text-muted-foreground">No archived categories yet.</p>
          ) : (
            navigation.map((category) => {
              const isExpanded = expanded.has(category.categoryId)
              return (
                <div key={category.categoryId} className="mb-2">
                  <button
                    onClick={() => toggleCategory(category.categoryId)}
                    aria-expanded={isExpanded}
                    className="w-full flex items-center gap-0.5 px-0.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none', !isExpanded && '-rotate-90')} />
                    <span className="truncate">{category.category}</span>
                  </button>
                  <div className="mt-0.5 space-y-0.5">
                    {category.channels
                      // Collapsed categories still pin their active channel, like Discord
                      .filter(ch => isExpanded || (selected?.categoryId === category.categoryId && selected?.channelId === ch.channelId))
                      .map((channel) => {
                        const isActive = selected?.channelId === channel.channelId
                        return (
                          <button
                            key={channel.channelId}
                            onClick={() => selectChannel(category, channel)}
                            aria-current={isActive ? 'page' : undefined}
                            title={`${channel.messageCount.toLocaleString()} messages`}
                            className={cn(
                              'w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                              isActive
                                ? 'bg-accent text-foreground font-medium'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                            )}
                          >
                            <Hash className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-foreground/70' : 'text-muted-foreground/60')} />
                            <span className="truncate">{channel.channelName}</span>
                          </button>
                        )
                      })}
                  </div>
                </div>
              )
            })
          )}
        </nav>
      </aside>

      {/* Main pane */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-border">
          <Button
            variant="ghost" size="sm"
            className="h-8 w-8 p-0 md:hidden -ml-1 text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open channel list"
          >
            <Menu className="h-4 w-4" />
          </Button>

          {isSearch ? (
            <div className="flex items-center gap-2 min-w-0">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold truncate">Search results</span>
            </div>
          ) : selected ? (
            <div className="flex items-center gap-2 min-w-0">
              <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold truncate">{selected.channelName}</span>
              <span className="hidden sm:flex items-center gap-2 min-w-0">
                <span className="h-4 w-px bg-border shrink-0" />
                <span className="text-xs text-muted-foreground truncate">{selected.category}</span>
              </span>
              {totalHits > 0 && !loading && (
                <span className="hidden md:inline text-xs text-muted-foreground tabular-nums shrink-0">
                  · {totalHits.toLocaleString()} messages
                </span>
              )}
            </div>
          ) : null}

          <div className="flex-1" />

          <div className="relative w-36 sm:w-56 md:w-64 shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search messages"
              aria-label="Search messages"
              className="h-8 pl-8 pr-7 text-sm bg-input/50 border-border placeholder:text-muted-foreground"
            />
            {queryInput && (
              <button
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="h-full flex items-center justify-center gap-3 text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm">{isSearch ? 'Searching…' : 'Loading messages…'}</span>
            </div>
          ) : displayMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
              {isSearch ? (
                <>
                  <p className="text-sm text-muted-foreground">No messages match “{query.trim()}”.</p>
                  <p className="text-xs text-muted-foreground/70">Try different keywords, or browse channels on the left.</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {selected ? 'No messages in this channel.' : 'Pick a channel to start reading.'}
                </p>
              )}
            </div>
          ) : (
            <div className={cn('mx-auto w-full max-w-4xl px-3 py-4', isSearch ? 'space-y-2' : 'space-y-px')}>
              {isSearch && (
                <p className="px-1 pb-1 text-xs text-muted-foreground tabular-nums">
                  {totalHits.toLocaleString()} results for “{query.trim()}”
                </p>
              )}
              {displayMessages.map(renderMessage)}
            </div>
          )}
        </div>

        {!loading && totalPages > 1 && (
          <footer className="h-11 shrink-0 border-t border-border flex items-center justify-between px-3">
            {isSearch ? (
              <>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                    disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                    disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Older
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <Button variant="ghost" size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Newer
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </footer>
        )}
      </main>
    </div>
  )
}
