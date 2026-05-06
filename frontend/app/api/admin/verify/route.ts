import { NextRequest, NextResponse } from 'next/server'
import { signToken } from '@/app/api/admin/auth/route'

const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  try {
    const adminToken = request.cookies.get('admin-token')

    if (!adminToken) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    const parts = adminToken.value.split('.')
    if (parts.length !== 3) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    const [tsStr, nonce, sig] = parts
    const timestamp = parseInt(tsStr, 10)

    if (isNaN(timestamp) || Date.now() - timestamp > TOKEN_MAX_AGE_MS) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    const expectedSig = signToken(timestamp, nonce)
    if (sig !== expectedSig) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    return NextResponse.json({ authenticated: true })
  } catch (error) {
    console.error('Admin verify error:', error)
    return NextResponse.json({ authenticated: false }, { status: 500 })
  }
}
