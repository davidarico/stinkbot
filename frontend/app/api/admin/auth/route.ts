import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json()
    
    if (!password) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    // Get admin password from database
    const storedPassword = await db.getAdminSetting('admin_password')

    if (!storedPassword) {
      return NextResponse.json({ error: 'Admin password not configured' }, { status: 500 })
    }
    const isValid = password === storedPassword

    if (isValid) {
      // Create a simple session token (in production, use proper JWT or session management)
      const token = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64')
      
      const response = NextResponse.json({ success: true, token })
      
      // Set cookie for admin session (expires in 24 hours)
      response.cookies.set('admin-token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 // 24 hours
      })
      
      return response
    } else {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }
  } catch (error) {
    console.error('Admin auth error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
