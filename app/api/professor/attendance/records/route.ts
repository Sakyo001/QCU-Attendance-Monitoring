import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID required' },
        { status: 400 },
      )
    }

    // Fetch attendance session details to get shift_opened_at
    const { data: sessionData, error: sessionError } = await supabase
      .from('attendance_sessions')
      .select('id, shift_opened_at')
      .eq('id', sessionId)
      .single()

    if (sessionError || !sessionData) {
      console.error('Error fetching session:', sessionError)
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 },
      )
    }

    // Fetch attendance records using the correct column name
    const { data: recordsData, error: recordsError } = await supabase
      .from('attendance_records')
      .select('id, attendance_session_id, student_number, checked_in_at, status, face_match_confidence, created_at')
      .eq('attendance_session_id', sessionId)
      .order('checked_in_at', { ascending: true })

    if (recordsError) {
      console.error('Error fetching attendance records:', recordsError)
      return NextResponse.json(
        { success: false, error: recordsError.message },
        { status: 500 },
      )
    }

    if (!recordsData || recordsData.length === 0) {
      return NextResponse.json({
        success: true,
        records: [],
      })
    }

    // Get unique student numbers from records
    const studentNumbers = [...new Set(recordsData.map((r: any) => r.student_number))]

    // Fetch student details from student_face_registrations
    const { data: studentsData, error: studentsError } = await supabase
      .from('student_face_registrations')
      .select('student_number, first_name, last_name')
      .in('student_number', studentNumbers)

    if (studentsError) {
      console.error('Error fetching students:', studentsError)
      return NextResponse.json(
        { success: false, error: studentsError.message },
        { status: 500 },
      )
    }

    // Create a map of students by student_number for quick lookup
    const studentsMap = new Map(studentsData?.map((s: any) => [s.student_number, s]) ?? [])

    // Calculate status based on timing
    const shiftOpenTime = new Date(sessionData.shift_opened_at).getTime()
    const lateThreshold = shiftOpenTime + 30 * 60 * 1000 // 30 minutes

    // Transform response to flatten student data and calculate status
    const records = recordsData.map((record: any) => {
      const student = studentsMap.get(record.student_number)
      const checkedInTime = new Date(record.checked_in_at).getTime()
      
      // Determine status based on time
      let computedStatus = record.status || 'present'
      if (checkedInTime > lateThreshold) {
        computedStatus = 'late'
      }

      return {
        id: record.id,
        attendance_session_id: record.attendance_session_id,
        student_number: record.student_number,
        checked_in_at: record.checked_in_at,
        status: computedStatus,
        face_match_confidence: record.face_match_confidence,
        created_at: record.created_at,
        first_name: student?.first_name,
        last_name: student?.last_name,
      }
    })

    return NextResponse.json({
      success: true,
      records,
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    )
  }
}
