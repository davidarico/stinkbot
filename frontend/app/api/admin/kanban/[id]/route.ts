import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

// PUT /api/admin/kanban/[id] - Update a kanban task
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = parseInt(await (params.id))
    
    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const updates = await request.json()
    
    // Validate status if provided
    if (updates.status) {
      const validStatuses = ['todo', 'in_progress', 'blocked', 'done']
      if (!validStatuses.includes(updates.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
    }

    // Validate title if provided
    if (updates.title !== undefined) {
      if (typeof updates.title !== 'string' || updates.title.trim().length === 0) {
        return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
      }
      updates.title = updates.title.trim()
    }

    // Validate description if provided
    if (updates.description !== undefined && updates.description !== null) {
      if (typeof updates.description !== 'string') {
        return NextResponse.json({ error: 'Description must be a string' }, { status: 400 })
      }
      updates.description = updates.description.trim() || null
    }

    // Validate position if provided
    if (updates.position !== undefined) {
      if (typeof updates.position !== 'number' || updates.position < 0) {
        return NextResponse.json({ error: 'Position must be a non-negative number' }, { status: 400 })
      }
    }

    const result = await db.updateKanbanTask(taskId, updates)
    
    if (result.success) {
      return NextResponse.json({ success: true, task: result.task })
    } else {
      return NextResponse.json({ error: result.message || 'Failed to update task' }, { status: 404 })
    }
  } catch (error) {
    console.error('Error updating kanban task:', error)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}

// DELETE /api/admin/kanban/[id] - Delete a kanban task
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = parseInt(await (params.id))
    
    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const result = await db.deleteKanbanTask(taskId)
    
    if (result.success) {
      return NextResponse.json({ success: true, task: result.task })
    } else {
      return NextResponse.json({ error: result.message || 'Failed to delete task' }, { status: 404 })
    }
  } catch (error) {
    console.error('Error deleting kanban task:', error)
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}
