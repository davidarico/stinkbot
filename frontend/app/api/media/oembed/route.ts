import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const platform = searchParams.get('platform')

    if (!url) {
      return NextResponse.json(
        { error: 'URL parameter is required' },
        { status: 400 }
      )
    }

    let oembedUrl: string
    let params: Record<string, string> = {}

    switch (platform) {
      case 'giphy':
        // Extract Giphy ID from URL
        const giphyMatch = url.match(/giphy\.com\/gifs\/([^\/\?]+)/)
        if (!giphyMatch) {
          return NextResponse.json(
            { error: 'Invalid Giphy URL' },
            { status: 400 }
          )
        }
        const giphyId = giphyMatch[1]
        oembedUrl = `https://giphy.com/services/oembed`
        params = {
          url: `https://giphy.com/gifs/${giphyId}`,
          format: 'json'
        }
        break

      case 'tenor':
        oembedUrl = 'https://tenor.com/oembed'
        params = {
          url: url,
          format: 'json'
        }
        break

      case 'imgur':
        // Imgur doesn't have a public oEmbed API, so we'll create a custom response
        const imgurMatch = url.match(/imgur\.com\/([a-zA-Z0-9]+)/)
        if (!imgurMatch) {
          return NextResponse.json(
            { error: 'Invalid Imgur URL' },
            { status: 400 }
          )
        }
        const imgurId = imgurMatch[1]
        
        // Return a custom oEmbed response for Imgur
        return NextResponse.json({
          type: 'photo',
          url: `https://i.imgur.com/${imgurId}.jpg`,
          width: 480,
          height: 360,
          title: 'Imgur Image',
          provider_name: 'Imgur',
          provider_url: 'https://imgur.com'
        })

      default:
        return NextResponse.json(
          { error: 'Unsupported platform' },
          { status: 400 }
        )
    }

    // Build the oEmbed URL with parameters
    const urlObj = new URL(oembedUrl)
    Object.entries(params).forEach(([key, value]) => {
      urlObj.searchParams.append(key, value)
    })

    // Fetch oEmbed data
    const response = await fetch(urlObj.toString())
    
    if (!response.ok) {
      throw new Error(`oEmbed request failed: ${response.status}`)
    }

    const oembedData = await response.json()
    
    return NextResponse.json(oembedData)
  } catch (error) {
    console.error('oEmbed error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media data' },
      { status: 500 }
    )
  }
}
