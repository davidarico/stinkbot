import { createHmac, randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'

const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60
const TOKEN_SECRET = process.env.GAME_TOKEN_SECRET || process.env.ADMIN_TOKEN_SECRET

if (!TOKEN_SECRET) {
  console.warn('GAME_TOKEN_SECRET is not set; game dashboard sessions are disabled.')
}

export function verifyPasswordHash(password: string, encodedHash: string): boolean {
  try {
    const [algorithm, saltValue, hashValue] = encodedHash.split('$')
    if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false

    const expected = Buffer.from(hashValue, 'base64url')
    const actual = scryptSync(password, Buffer.from(saltValue, 'base64url'), expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function cookieName(gameId: string): string {
  return `game-${gameId}-session`
}

function signature(gameId: string, timestamp: number, nonce: string): string | null {
  if (!TOKEN_SECRET) return null
  return createHmac('sha256', TOKEN_SECRET)
    .update(`${gameId}:${timestamp}:${nonce}`)
    .digest('base64url')
}

export function setGameSession(response: NextResponse, gameId: string): boolean {
  const timestamp = Date.now()
  const nonce = randomUUID()
  const sig = signature(gameId, timestamp, nonce)
  if (!sig) return false

  response.cookies.set(cookieName(gameId), `${timestamp}.${nonce}.${sig}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return true
}

export function hasValidGameSession(request: NextRequest, gameId: string): boolean {
  const token = request.cookies.get(cookieName(gameId))?.value
  if (!token || !TOKEN_SECRET) return false

  const [timestampValue, nonce, suppliedSignature] = token.split('.')
  const timestamp = Number(timestampValue)
  if (!timestamp || !nonce || !suppliedSignature) return false
  if (Date.now() - timestamp > SESSION_MAX_AGE_SECONDS * 1000 || timestamp > Date.now() + 60_000) return false

  const expectedSignature = signature(gameId, timestamp, nonce)
  if (!expectedSignature) return false

  const expected = Buffer.from(expectedSignature)
  const supplied = Buffer.from(suppliedSignature)
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}
