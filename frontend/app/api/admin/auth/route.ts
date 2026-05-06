import { NextRequest, NextResponse } from 'next/server'
import { createHmac, randomBytes } from 'crypto'
import { db } from '@/lib/database'

const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET
if (!TOKEN_SECRET) {
  console.warn('ADMIN_TOKEN_SECRET is not set — admin sessions will not survive restarts and are less secure.')
}

export function signToken(timestamp: number, nonce: string): string {
  const secret = TOKEN_SECRET || 'fallback-insecure-secret'
  return createHmac('sha256', secret).update(`${timestamp}:${nonce}`).digest('hex')
}

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json()

    if (!password) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    const storedPassword = await db.getAdminSetting('admin_password')

    if (!storedPassword) {
      return NextResponse.json({ error: 'Admin password not configured' }, { status: 500 })
    }

    if (password !== storedPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    const timestamp = Date.now()
    const nonce = randomBytes(16).toString('hex')
    const sig = signToken(timestamp, nonce)
    const token = `${timestamp}.${nonce}.${sig}`

    const response = NextResponse.json({ success: true })
    response.cookies.set('admin-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
    })
    return response
  } catch (error) {
    console.error('Admin auth error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
