import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const adminToken = request.cookies.get('admin-token')
    
    if (!adminToken) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    // In a production app, you'd validate the token properly
    // For now, we'll just check if it exists and is not expired
    try {
      const tokenData = Buffer.from(adminToken.value, 'base64').toString()
      const [timestamp] = tokenData.split('-')
      const tokenAge = Date.now() - parseInt(timestamp)
      
      // Token expires after 24 hours
      if (tokenAge > 24 * 60 * 60 * 1000) {
        return NextResponse.json({ authenticated: false }, { status: 401 })
      }
      
      return NextResponse.json({ authenticated: true })
    } catch (error) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }
  } catch (error) {
    console.error('Admin verify error:', error)
    return NextResponse.json({ authenticated: false }, { status: 500 })
  }
}
