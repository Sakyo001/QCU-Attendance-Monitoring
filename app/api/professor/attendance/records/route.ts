import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(request: NextRequest) {
  try {
    const sectionId = request.nextUrl.searchParams.get('sectionId')

    if (!sectionId) {
      return NextResponse.json(
        { success: false, error: 'Section ID required' },
        { status: 400 },
      )
    }

    // Get today's date in ISO format (YYYY-MM-DD)
    const todayDate = new Date().toISOString().split('T')[0]

    // Get all registered students in this section
    const { data: allRegisteredStudents, error: allStudentsError } = await supabase
      .from('student_face_registrations')
      .select('id, first_name, last_name, student_number')
      .eq('is_active', true)
      .order('last_name', { ascending: true })

    if (allStudentsError) {
      console.error('Error fetching all registered students:', allStudentsError)
      return NextResponse.json(
        { success: false, error: allStudentsError.message },
        { status: 500 },
      )
    }

    const registeredStudents = allRegisteredStudents || []
    console.log('📚 Found', registeredStudents.length, 'registered students')

    // Get student numbers to look up in users table
    const studentNumbers = registeredStudents.map(s => s.student_number)

    // Fetch users by student_number to get their IDs
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('id, student_id, first_name, last_name')
      .in('student_id', studentNumbers)

    if (usersError) {
      console.error('Error fetching users:', usersError)
      // Continue anyway, we'll just show all as absent
    }

    // Create a map of users by student_id for lookup
    const usersMap = new Map(usersData?.map((u: any) => [u.student_id, u]) ?? [])

    // Now fetch TODAY'S attendance records using attendance_session_id pattern
    // Generate today's session ID: same as in mark API
    const sessionKey = `attendance-${sectionId}-${todayDate}`
    const sessionId = uuidv5(sessionKey, NAMESPACE_NIL)
    
    const { data: recordsData, error: recordsError } = await supabase
      .from('attendance_records')
      .select('id, student_registration_id, student_number, checked_in_at, face_match_confidence, status, section_id')
      .eq('section_id', sectionId)
      .eq('attendance_session_id', sessionId)
      .order('checked_in_at', { ascending: true })

    if (recordsError) {
      console.error('Error fetching attendance records:', recordsError)
      // Continue anyway
    }

    console.log('📋 Found', recordsData?.length || 0, 'attendance records for today')

    // Create a map of today's attendance records by student_number for quick lookup
    const attendanceMap = new Map()
    recordsData?.forEach((record: any) => {
      attendanceMap.set(record.student_number, record)
    })

    // Merge: ALL registered students + today's attendance status
    const records = registeredStudents.map((student: any) => {
      // Get the user record to find their actual user ID
      const user = usersMap.get(student.student_number)
      const userId = user?.id
      
      // Look up attendance record using student_number (this is what's stored in attendance_records)
      const attendance = attendanceMap.get(student.student_number)
      
      return {
        id: student.id,
        student_id: userId || student.id,
        student_number: student.student_number,
        first_name: student.first_name,
        last_name: student.last_name,
        time_recorded: attendance?.checked_in_at || null,
        checked_in_at: attendance?.checked_in_at || null,
        status: attendance?.status || 'absent',
        face_match_confidence: attendance?.face_match_confidence || null,
        created_at: attendance?.checked_in_at || new Date().toISOString(),
        section_id: sectionId,
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
