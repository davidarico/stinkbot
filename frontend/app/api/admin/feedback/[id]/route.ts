import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

// DELETE /api/admin/feedback/[id] - Delete feedback
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const feedbackId = parseInt(id)
    
    if (isNaN(feedbackId)) {
      return NextResponse.json({ error: 'Invalid feedback ID' }, { status: 400 })
    }

    const result = await db.deleteFeedback(feedbackId)
    
    if (result.success) {
      return NextResponse.json({ success: true, feedback: result.feedback })
    } else {
      return NextResponse.json({ error: result.message || 'Failed to delete feedback' }, { status: 404 })
    }
  } catch (error) {
    console.error('Error deleting feedback:', error)
    return NextResponse.json({ error: 'Failed to delete feedback' }, { status: 500 })
  }
}
