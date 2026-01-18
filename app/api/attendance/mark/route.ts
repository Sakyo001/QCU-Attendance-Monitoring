import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId, studentId, status = 'present' } = body

    if (!sessionId || !studentId) {
      return NextResponse.json({ 
        error: 'Session ID and student ID are required' 
      }, { status: 400 })
    }

    // Check if attendance record already exists
    const { data: existing } = await supabase
      .from('attendance_records')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', studentId)
      .single()

    if (existing) {
      // Update existing record
      const { error: updateError } = await supabase
        .from('attendance_records')
        .update({
          status,
          time_in: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error('Update error:', updateError)
        return NextResponse.json({ 
          error: 'Failed to update attendance' 
        }, { status: 400 })
      }
    } else {
      // Create new attendance record
      const { error: insertError } = await supabase
        .from('attendance_records')
        .insert([
          {
            session_id: sessionId,
            user_id: studentId,
            status,
            time_in: new Date().toISOString(),
            created_at: new Date().toISOString()
          }
        ])

      if (insertError) {
        console.error('Insert error:', insertError)
        return NextResponse.json({ 
          error: 'Failed to mark attendance' 
        }, { status: 400 })
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Attendance marked successfully'
    })
  } catch (error) {
    console.error('Attendance error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
