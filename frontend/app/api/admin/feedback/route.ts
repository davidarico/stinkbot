import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'

// GET /api/admin/feedback - Get all feedback
export async function GET() {
  try {
    const feedback = await db.getFeedback()
    return NextResponse.json({ success: true, feedback })
  } catch (error) {
    console.error('Error fetching feedback:', error)
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 })
  }
}

// POST /api/admin/feedback - Create new feedback (for bot use)
export async function POST(request: NextRequest) {
  try {
    const { userId, displayName, feedbackText, serverId } = await request.json()
    
    if (!userId || !displayName || !feedbackText || !serverId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Validate input lengths to prevent abuse
    if (displayName.length > 255) {
      return NextResponse.json({ error: 'Display name too long' }, { status: 400 })
    }

    if (feedbackText.length > 2000) {
      return NextResponse.json({ error: 'Feedback text too long' }, { status: 400 })
    }

    // Sanitize inputs (basic validation)
    const sanitizedDisplayName = displayName.trim()
    const sanitizedFeedbackText = feedbackText.trim()

    if (sanitizedDisplayName.length === 0 || sanitizedFeedbackText.length === 0) {
      return NextResponse.json({ error: 'Display name and feedback text cannot be empty' }, { status: 400 })
    }

    const result = await db.createFeedback(userId, sanitizedDisplayName, sanitizedFeedbackText, serverId)
    
    if (result.success) {
      return NextResponse.json({ success: true, feedback: result.feedback })
    } else {
      return NextResponse.json({ error: 'Failed to create feedback' }, { status: 500 })
    }
  } catch (error) {
    console.error('Error creating feedback:', error)
    return NextResponse.json({ error: 'Failed to create feedback' }, { status: 500 })
  }
}
