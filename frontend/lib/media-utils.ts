// Media utilities for detecting and extracting media from various platforms

export interface MediaInfo {
  type: 'image' | 'video' | 'gif' | 'embed'
  url: string
  thumbnail?: string
  title?: string
}

// Regex patterns for various media platforms
const MEDIA_PATTERNS = {
  // Tenor GIFs
  tenor: /https?:\/\/(?:www\.)?tenor\.com\/view\/[^\/\s]+/i,
  
  // Giphy GIFs
  giphy: /https?:\/\/(?:www\.)?giphy\.com\/gifs\/([^\/\?]+)/i,
  
  // Imgur images/videos
  imgur: /https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)/i,
  
  // Direct image files
  directImage: /https?:\/\/[^\/\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\/\s]*)?$/i,
  
  // Direct video files
  directVideo: /https?:\/\/[^\/\s]+\.(mp4|webm|mov|avi)(\?[^\/\s]*)?$/i,
  
  // S3 hosted images/videos
  s3: /https?:\/\/[^\/\s]+\.s3\.[^\/\s]+\/[^\/\s]+\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)(\?[^\/\s]*)?$/i,
  
  // YouTube videos
  youtube: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/i,
  

  
  // Reddit media
  reddit: /https?:\/\/(?:www\.)?reddit\.com\/r\/[^\/]+\/comments\/[^\/]+\/[^\/]+/i
}

export function extractMediaFromContent(content: string): MediaInfo[] {
  const media: MediaInfo[] = []
  const lines = content.split('\n')
  
  for (const line of lines) {
    const trimmedLine = line.trim()
    
    // Check for Tenor GIFs
    const tenorMatch = trimmedLine.match(MEDIA_PATTERNS.tenor)
    if (tenorMatch) {
      // Extract the GIF ID from the URL
      const gifIdMatch = trimmedLine.match(/gif-(\d+)/)
      const gifId = gifIdMatch ? gifIdMatch[1] : null
      
      media.push({
        type: 'gif',
        url: gifId ? `https://tenor.com/view/gif-${gifId}` : trimmedLine,
        title: 'Tenor GIF'
      })
      continue
    }
    
    // Check for Giphy GIFs
    const giphyMatch = trimmedLine.match(MEDIA_PATTERNS.giphy)
    if (giphyMatch) {
      media.push({
        type: 'gif',
        url: trimmedLine,
        thumbnail: `https://media.giphy.com/media/${giphyMatch[1]}/giphy.gif`,
        title: 'Giphy GIF'
      })
      continue
    }
    
    // Check for Imgur
    const imgurMatch = trimmedLine.match(MEDIA_PATTERNS.imgur)
    if (imgurMatch) {
      media.push({
        type: 'image',
        url: trimmedLine,
        thumbnail: `https://i.imgur.com/${imgurMatch[1]}.jpg`,
        title: 'Imgur Image'
      })
      continue
    }
    
    // Check for direct image files
    const directImageMatch = trimmedLine.match(MEDIA_PATTERNS.directImage)
    if (directImageMatch) {
      const extension = directImageMatch[1].toLowerCase()
      media.push({
        type: extension === 'gif' ? 'gif' : 'image',
        url: trimmedLine,
        title: `Image (${extension.toUpperCase()})`
      })
      continue
    }
    
    // Check for direct video files
    const directVideoMatch = trimmedLine.match(MEDIA_PATTERNS.directVideo)
    if (directVideoMatch) {
      media.push({
        type: 'video',
        url: trimmedLine,
        title: `Video (${directVideoMatch[1].toUpperCase()})`
      })
      continue
    }
    
    // Check for S3 hosted media
    const s3Match = trimmedLine.match(MEDIA_PATTERNS.s3)
    if (s3Match) {
      const extension = s3Match[1].toLowerCase()
      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
        media.push({
          type: extension === 'gif' ? 'gif' : 'image',
          url: trimmedLine,
          title: `Image (${extension.toUpperCase()})`
        })
      } else if (['mp4', 'webm', 'mov'].includes(extension)) {
        media.push({
          type: 'video',
          url: trimmedLine,
          title: `Video (${extension.toUpperCase()})`
        })
      }
      continue
    }
    
    // Check for YouTube videos
    const youtubeMatch = trimmedLine.match(MEDIA_PATTERNS.youtube)
    if (youtubeMatch) {
      media.push({
        type: 'video',
        url: trimmedLine,
        thumbnail: `https://img.youtube.com/vi/${youtubeMatch[1]}/maxresdefault.jpg`,
        title: 'YouTube Video'
      })
      continue
    }
    

    
    // Check for Reddit media
    const redditMatch = trimmedLine.match(MEDIA_PATTERNS.reddit)
    if (redditMatch) {
      media.push({
        type: 'embed',
        url: trimmedLine,
        title: 'Reddit Post'
      })
      continue
    }
  }
  
  return media
}

export function isMediaUrl(url: string): boolean {
  return Object.values(MEDIA_PATTERNS).some(pattern => pattern.test(url))
}

export function getMediaType(url: string): 'image' | 'video' | 'gif' | 'embed' | null {
  if (MEDIA_PATTERNS.tenor.test(url) || MEDIA_PATTERNS.giphy.test(url)) {
    return 'gif'
  }
  if (MEDIA_PATTERNS.imgur.test(url) || MEDIA_PATTERNS.directImage.test(url) || MEDIA_PATTERNS.s3.test(url)) {
    const extension = url.split('.').pop()?.toLowerCase()
    return extension === 'gif' ? 'gif' : 'image'
  }
  if (MEDIA_PATTERNS.directVideo.test(url) || MEDIA_PATTERNS.youtube.test(url)) {
    return 'video'
  }
  if (MEDIA_PATTERNS.reddit.test(url)) {
    return 'embed'
  }
  return null
}
