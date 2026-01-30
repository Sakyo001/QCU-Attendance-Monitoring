import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { sessionId, eventType, professorId } = body

    if (!sessionId || !eventType) {
      return NextResponse.json({ error: 'Session ID and event type are required' }, { status: 400 })
    }

    // Insert log record
    const { error: insertError } = await supabase.from('attendance_logs').insert([
      {
        session_id: sessionId,
        event_type: eventType,
        professor_id: professorId || null,
        timestamp: new Date().toISOString()
      }
    ])

    if (insertError) {
      console.error('Attendance log insert error:', insertError)
      return NextResponse.json({ 
        error: 'Failed to create log record',
        details: insertError.message
      }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: 'Shift event logged successfully'
    })
  } catch (error) {
    console.error('Log error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
