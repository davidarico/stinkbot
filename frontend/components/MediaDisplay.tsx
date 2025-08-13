'use client'

import { useState, useEffect } from 'react'
import { MediaInfo } from '@/lib/media-utils'
import { ExternalLink, Play, Image as ImageIcon, Loader2 } from 'lucide-react'

interface OEmbedData {
  type: string
  url?: string
  html?: string
  width?: number
  height?: number
  title?: string
  provider_name?: string
  provider_url?: string
}

interface MediaDisplayProps {
  media: MediaInfo[]
  className?: string
}

// Component for embedded media (Giphy, Tenor, Imgur)
function EmbeddedMedia({ url, platform }: { url: string; platform: string }) {
  const [oembedData, setOembedData] = useState<OEmbedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchOEmbed = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/media/oembed?url=${encodeURIComponent(url)}&platform=${platform}`)
        
        if (!response.ok) {
          throw new Error('Failed to fetch media data')
        }
        
        const data = await response.json()
        setOembedData(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load media')
      } finally {
        setLoading(false)
      }
    }

    fetchOEmbed()
  }, [url, platform])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 bg-gray-700 rounded-lg">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-400">Loading {platform} content...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-red-500 rounded-lg p-3 bg-red-900/20">
        <div className="flex items-center gap-2 mb-2">
          <ExternalLink className="h-4 w-4 text-red-400" />
          <span className="text-sm text-red-300">Failed to load {platform} content</span>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 text-sm break-all"
        >
          {url}
        </a>
      </div>
    )
  }

  if (!oembedData) {
    return null
  }

  // Render based on oEmbed type
  if (oembedData.html) {
    // For Giphy and Tenor that provide HTML
    return (
      <div 
        className="rounded-lg overflow-hidden"
        dangerouslySetInnerHTML={{ __html: oembedData.html }}
      />
    )
  }

  if (oembedData.type === 'photo' && oembedData.url) {
    // For Imgur images
    return (
      <div className="relative group">
        <img
          src={oembedData.url}
          alt={oembedData.title || `${platform} content`}
          className="rounded-lg max-w-full max-h-96 object-contain"
        />
        {oembedData.title && (
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            {oembedData.title}
          </div>
        )}
      </div>
    )
  }

  // Fallback to link
  return (
    <div className="border border-gray-600 rounded-lg p-3 bg-gray-700">
      <div className="flex items-center gap-2 mb-2">
        <ExternalLink className="h-4 w-4 text-gray-400" />
        <span className="text-sm text-gray-300">{oembedData.title || platform}</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300 text-sm break-all"
      >
        {url}
      </a>
    </div>
  )
}

export function MediaDisplay({ media, className = '' }: MediaDisplayProps) {
  const [expandedMedia, setExpandedMedia] = useState<number | null>(null)

  if (!media || media.length === 0) {
    return null
  }

  const handleMediaClick = (index: number) => {
    setExpandedMedia(expandedMedia === index ? null : index)
  }

  const renderMediaItem = (item: MediaInfo, index: number) => {
    const isExpanded = expandedMedia === index

    // Check if this is an embedded platform
    if (item.url.includes('tenor.com')) {
      return <EmbeddedMedia key={index} url={item.url} platform="tenor" />
    }
    
    if (item.url.includes('giphy.com')) {
      return <EmbeddedMedia key={index} url={item.url} platform="giphy" />
    }
    
    if (item.url.includes('imgur.com')) {
      return <EmbeddedMedia key={index} url={item.url} platform="imgur" />
    }

    switch (item.type) {
      case 'image':
        return (
          <div key={index} className="relative group">
            <img
              src={item.url}
              alt={item.title || 'Image'}
              className={`rounded-lg cursor-pointer transition-all duration-200 ${
                isExpanded ? 'max-w-full max-h-96' : 'max-w-48 max-h-32 object-cover'
              }`}
              onClick={() => handleMediaClick(index)}
            />
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 rounded-lg flex items-center justify-center">
              <ImageIcon className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            </div>
          </div>
        )

      case 'gif':
        return (
          <div key={index} className="relative group">
            <img
              src={item.url}
              alt={item.title || 'GIF'}
              className={`rounded-lg cursor-pointer transition-all duration-200 ${
                isExpanded ? 'max-w-full max-h-96' : 'max-w-48 max-h-32 object-cover'
              }`}
              onClick={() => handleMediaClick(index)}
            />
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 rounded-lg flex items-center justify-center">
              <Play className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            </div>
          </div>
        )

      case 'video':
        return (
          <div key={index} className="relative group">
            <video
              src={item.url}
              controls
              className={`rounded-lg ${
                isExpanded ? 'max-w-full max-h-96' : 'max-w-48 max-h-32 object-cover'
              }`}
            />
            <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              {item.title}
            </div>
          </div>
        )

      case 'embed':
        return (
          <div key={index} className="border border-gray-600 rounded-lg p-3 bg-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <ExternalLink className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-300">{item.title}</span>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 text-sm break-all"
            >
              {item.url}
            </a>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {media.map((item, index) => renderMediaItem(item, index))}
    </div>
  )
}

// Component for displaying a single media item inline
export function InlineMediaDisplay({ media }: { media: MediaInfo }) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Check if this is an embedded platform
  if (media.url.includes('tenor.com') || media.url.includes('giphy.com') || media.url.includes('imgur.com')) {
    const platform = media.url.includes('tenor.com') ? 'tenor' : 
                    media.url.includes('giphy.com') ? 'giphy' : 'imgur'
    return <EmbeddedMedia url={media.url} platform={platform} />
  }

  switch (media.type) {
    case 'image':
    case 'gif':
      return (
        <div className="inline-block">
          <img
            src={media.url}
            alt={media.title || 'Media'}
            className={`rounded cursor-pointer transition-all duration-200 ${
              isExpanded ? 'max-w-full max-h-64' : 'max-h-20'
            }`}
            onClick={() => setIsExpanded(!isExpanded)}
          />
        </div>
      )

    case 'video':
      return (
        <div className="inline-block">
          <video
            src={media.url}
            controls
            className={`rounded max-h-32`}
          />
        </div>
      )

    case 'embed':
      return (
        <a
          href={media.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm"
        >
          <ExternalLink className="h-3 w-3" />
          {media.title}
        </a>
      )

    default:
      return null
  }
}
