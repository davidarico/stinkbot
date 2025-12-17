import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

interface RouteParams {
  params: Promise<{ serverId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { serverId } = await params
    const roles = await db.getServerRoles(serverId)
    return NextResponse.json({ success: true, roles })
  } catch (error) {
    console.error('Error fetching server roles:', error)
    return NextResponse.json({ error: 'Failed to fetch server roles' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { serverId } = await params
    const body = await request.json()
    
    const role = await db.createServerRole({
      name: body.name,
      serverId: serverId,
      team: body.team,
      description: body.description,
      targets: body.targets,
      moves: body.moves || false,
      standardResultsFlavor: body.standardResultsFlavor,
      immunities: body.immunities,
      specialProperties: body.specialProperties,
      framerInteraction: body.framerInteraction,
      inWolfChat: body.inWolfChat || false,
      hasCharges: body.hasCharges || false,
      defaultCharges: body.defaultCharges || 0,
      hasWinByNumber: body.hasWinByNumber || false,
      defaultWinByNumber: body.defaultWinByNumber || 0,
      isSpotlight: body.isSpotlight || false
    })
    
    return NextResponse.json({ success: true, role })
  } catch (error: any) {
    console.error('Error creating server role:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to create server role' 
    }, { status: 500 })
  }
}

