import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

/**
 * Get all enrolled students in a section with their attendance status for today.
 * Used by the kiosk to display the real-time student list.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)
    const sectionId = searchParams.get('sectionId')

    if (!sectionId) {
      return NextResponse.json({ error: 'sectionId required' }, { status: 400 })
    }

    // Get all registered students in this section
    const { data: students, error: studentsError } = await supabase
      .from('student_face_registrations')
      .select('id, student_number, first_name, last_name')
      .eq('section_id', sectionId)
      .eq('is_active', true)
      .order('last_name')

    if (studentsError) {
      console.error('Error fetching students:', studentsError)
      return NextResponse.json({ error: 'Failed to fetch students' }, { status: 400 })
    }

    // Get today's attendance records
    const todayDate = new Date().toISOString().split('T')[0]
    const sessionKey = `attendance-${sectionId}-${todayDate}`
    const sessionId = uuidv5(sessionKey, NAMESPACE_NIL)

    const { data: records, error: recordsError } = await supabase
      .from('attendance_records')
      .select('student_number, status, checked_in_at, face_match_confidence')
      .eq('attendance_session_id', sessionId)

    if (recordsError) {
      console.error('Error fetching records:', recordsError)
    }

    // Map records by student number
    const recordMap = new Map(
      (records || []).map(r => [r.student_number, r])
    )

    // Build student list with status
    const studentList = (students || []).map(s => {
      const record = recordMap.get(s.student_number)
      return {
        id: s.id,
        studentNumber: s.student_number,
        firstName: s.first_name,
        lastName: s.last_name,
        status: record?.status || 'pending',
        checkedInAt: record?.checked_in_at || null,
        confidence: record?.face_match_confidence || null
      }
    })

    const present = studentList.filter(s => s.status === 'present').length
    const late = studentList.filter(s => s.status === 'late').length
    const absent = studentList.filter(s => s.status === 'absent').length
    const pending = studentList.filter(s => s.status === 'pending').length

    return NextResponse.json({
      success: true,
      students: studentList,
      stats: { present, late, absent, pending, total: studentList.length }
    })
  } catch (error) {
    console.error('Error fetching enrolled students:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
