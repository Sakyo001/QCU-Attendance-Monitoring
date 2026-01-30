import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { classSessionId, professorId } = body

    if (!classSessionId || !professorId) {
      return NextResponse.json(
        { error: 'Class session ID and professor ID are required' },
        { status: 400 }
      )
    }

    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()

    // Check if there's already an active session today
    const { data: existingSession } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('class_session_id', classSessionId)
      .eq('session_date', today)
      .single()

    let session

    if (existingSession) {
      // Update existing session to active
      const { data, error } = await supabase
        .from('attendance_sessions')
        .update({
          is_active: true,
          shift_opened_at: now,
          shift_closed_at: null
        })
        .eq('id', existingSession.id)
        .select()
        .single()

      if (error) {
        console.error('Error updating session:', error)
        return NextResponse.json(
          { error: 'Failed to open shift' },
          { status: 500 }
        )
      }

      session = data
    } else {
      // Create new session
      const { data, error } = await supabase
        .from('attendance_sessions')
        .insert({
          class_session_id: classSessionId,
          professor_id: professorId,
          session_date: today,
          is_active: true,
          shift_opened_at: now
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating session:', error)
        return NextResponse.json(
          { error: 'Failed to open shift' },
          { status: 500 }
        )
      }

      session = data
    }

    return NextResponse.json({
      success: true,
      message: 'Shift opened successfully',
      session
    })

  } catch (error: any) {
    console.error('Exception in open shift:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
