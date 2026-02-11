import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)
    const sectionId = searchParams.get('sectionId')
    const date = searchParams.get('date') // format: YYYY-MM-DD

    if (!sectionId || !date) {
      return NextResponse.json({ error: 'sectionId and date are required' }, { status: 400 })
    }

    // Generate session ID for the requested date
    const sessionKey = `attendance-${sectionId}-${date}`
    const sessionId = uuidv5(sessionKey, NAMESPACE_NIL)

    // Get all registered students in this section
    const { data: allStudents, error: studentsError } = await supabase
      .from('student_face_registrations')
      .select('id, first_name, last_name, student_number')
      .eq('is_active', true)
      .eq('section_id', sectionId)
      .order('last_name', { ascending: true })

    if (studentsError) {
      console.error('Error fetching students:', studentsError)
      return NextResponse.json({ error: studentsError.message }, { status: 500 })
    }

    // Get attendance records for the specific date
    const { data: records, error: recordsError } = await supabase
      .from('attendance_records')
      .select('id, student_number, status, checked_in_at, face_match_confidence')
      .eq('attendance_session_id', sessionId)
      .eq('section_id', sectionId)
      .order('checked_in_at', { ascending: true })

    if (recordsError) {
      console.error('Error fetching attendance records:', recordsError)
      return NextResponse.json({ error: recordsError.message }, { status: 500 })
    }

    // Create attendance map
    const attendanceMap = new Map(
      (records || []).map((r: any) => [r.student_number, r])
    )

    // Merge students with attendance data
    const students = (allStudents || []).map((student: any) => {
      const attendance = attendanceMap.get(student.student_number) as any
      return {
        id: student.id,
        student_number: student.student_number,
        first_name: student.first_name,
        last_name: student.last_name,
        status: attendance?.status || 'absent',
        checked_in_at: attendance?.checked_in_at || null,
        face_match_confidence: attendance?.face_match_confidence || null
      }
    })

    // Summary for this date
    const present = students.filter(s => s.status === 'present').length
    const late = students.filter(s => s.status === 'late').length
    const absent = students.filter(s => s.status === 'absent').length

    // Get section info
    const { data: sectionData } = await supabase
      .from('sections')
      .select('section_code, semester, academic_year')
      .eq('id', sectionId)
      .single()

    return NextResponse.json({
      success: true,
      date,
      section: sectionData || { section_code: sectionId },
      summary: { present, late, absent, total: students.length },
      students
    })
  } catch (error) {
    console.error('Error fetching daily detail:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
