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

    switch (platform) {
      case 'giphy': {
        const giphyMatch = url.match(/giphy\.com\/gifs\/([^\/\?]+)/)
        if (!giphyMatch) {
          return NextResponse.json({ error: 'Invalid Giphy URL' }, { status: 400 })
        }
        const slug = giphyMatch[1]
        // Last hyphen-separated token is the Giphy ID
        const giphyId = slug.split('-').pop() ?? slug

        const oembedUrl = new URL('https://giphy.com/services/oembed')
        oembedUrl.searchParams.set('url', `https://giphy.com/gifs/${slug}`)
        oembedUrl.searchParams.set('format', 'json')

        const res = await fetch(oembedUrl.toString())
        if (!res.ok) throw new Error(`Giphy oEmbed failed: ${res.status}`)
        const { html: _html, ...data } = await res.json()

        // Inject a direct media URL so the client can render an <img> without
        // dangerouslySetInnerHTML. Giphy media URLs follow a stable pattern.
        return NextResponse.json({
          ...data,
          type: 'photo',
          media_url: `https://media.giphy.com/media/${giphyId}/giphy.gif`,
        })
      }

      case 'tenor': {
        const oembedUrl = new URL('https://tenor.com/oembed')
        oembedUrl.searchParams.set('url', url)
        oembedUrl.searchParams.set('format', 'json')

        const res = await fetch(oembedUrl.toString())
        if (!res.ok) throw new Error(`Tenor oEmbed failed: ${res.status}`)
        // Strip html; Tenor also returns thumbnail_url which the client uses.
        const { html: _html, ...data } = await res.json()
        return NextResponse.json(data)
      }

      case 'imgur': {
        const imgurMatch = url.match(/imgur\.com\/([a-zA-Z0-9]+)/)
        if (!imgurMatch) {
          return NextResponse.json({ error: 'Invalid Imgur URL' }, { status: 400 })
        }
        const imgurId = imgurMatch[1]
        return NextResponse.json({
          type: 'photo',
          url: `https://i.imgur.com/${imgurId}.jpg`,
          width: 480,
          height: 360,
          title: 'Imgur Image',
          provider_name: 'Imgur',
          provider_url: 'https://imgur.com',
        })
      }

      default:
        return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 })
    }
  } catch (error) {
    console.error('oEmbed error:', error)
    return NextResponse.json({ error: 'Failed to fetch media data' }, { status: 500 })
  }
}
