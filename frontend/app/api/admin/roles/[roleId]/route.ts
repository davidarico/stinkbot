import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

interface RouteParams {
  params: Promise<{ roleId: string }>
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { roleId } = await params
    const role = await db.deleteServerRole(parseInt(roleId))
    return NextResponse.json({ success: true, role })
  } catch (error: any) {
    console.error('Error deleting server role:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to delete server role' 
    }, { status: 500 })
  }
}

