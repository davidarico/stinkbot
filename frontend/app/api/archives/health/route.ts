import { NextResponse } from 'next/server'
import { db } from '@/lib/database'

export async function GET() {
  try {
    const result = await db.getArchiveHealth()
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Archive health check failed:', error)
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error?.message || 'Unknown error',
        config: { storage: 'database' }
      },
      { status: 500 }
    )
  }
}
