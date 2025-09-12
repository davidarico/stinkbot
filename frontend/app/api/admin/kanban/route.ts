import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

// GET /api/admin/kanban - Get all kanban tasks
export async function GET() {
  try {
    const tasks = await db.getKanbanTasks()
    return NextResponse.json({ success: true, tasks })
  } catch (error) {
    console.error('Error fetching kanban tasks:', error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

// POST /api/admin/kanban - Create a new kanban task
export async function POST(request: NextRequest) {
  try {
    const { title, description, status } = await request.json()
    
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const validStatuses = ['todo', 'in_progress', 'blocked', 'done']
    const taskStatus = status && validStatuses.includes(status) ? status : 'todo'

    const result = await db.createKanbanTask(title.trim(), description?.trim(), taskStatus)
    
    if (result.success) {
      return NextResponse.json({ success: true, task: result.task })
    } else {
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
    }
  } catch (error) {
    console.error('Error creating kanban task:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
