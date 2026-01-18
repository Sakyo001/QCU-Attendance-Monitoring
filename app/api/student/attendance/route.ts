import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(request: NextRequest) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }

    const { studentId } = await request.json()

    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'Student ID required' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get the current active session
    const { data: sessionData, error: sessionError } = await supabase
      .from('attendance_sessions')
      .select('id, class_session_id')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (sessionError || !sessionData) {
      return NextResponse.json(
        { success: false, error: 'No active attendance session' },
        { status: 404 }
      )
    }

    // Check if student already marked attendance in this session
    const { data: existingRecord, error: checkError } = await supabase
      .from('attendance_records')
      .select('id')
      .eq('student_id', studentId)
      .eq('session_id', sessionData.id)
      .single()

    if (!checkError && existingRecord) {
      // Student already marked attendance
      return NextResponse.json({
        success: true,
        message: 'Attendance already marked for this session',
        alreadyMarked: true
      })
    }

    // Mark attendance as present
    const { data, error } = await supabase
      .from('attendance_records')
      .insert({
        student_id: studentId,
        session_id: sessionData.id,
        status: 'present',
        marked_at: new Date().toISOString()
      })
      .select()

    if (error) {
      console.error('Attendance insertion error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to mark attendance' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Attendance marked successfully',
      attendanceRecord: data?.[0]
    })
  } catch (error) {
    console.error('Mark attendance error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Optional: GET endpoint to check attendance status
export async function GET(request: NextRequest) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }

    const { searchParams } = new URL(request.url)
    const studentId = searchParams.get('studentId')

    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'Student ID required' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get current session
    const { data: sessionData } = await supabase
      .from('attendance_sessions')
      .select('id')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!sessionData) {
      return NextResponse.json({
        success: true,
        hasMarkedAttendance: false
      })
    }

    // Check if student marked attendance
    const { data: record } = await supabase
      .from('attendance_records')
      .select('id, status')
      .eq('student_id', studentId)
      .eq('session_id', sessionData.id)
      .single()

    return NextResponse.json({
      success: true,
      hasMarkedAttendance: !!record,
      status: record?.status || null
    })
  } catch (error) {
    console.error('Get attendance status error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
