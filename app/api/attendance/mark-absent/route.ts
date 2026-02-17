import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

/**
 * Mark all unscanned students in a section as absent.
 * Called when attendance is locked (30+ minutes past class start).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { sectionId } = body

    if (!sectionId) {
      return NextResponse.json({ error: 'sectionId is required' }, { status: 400 })
    }

    const todayDate = new Date().toISOString().split('T')[0]
    const sessionKey = `attendance-${sectionId}-${todayDate}`
    const sessionId = uuidv5(sessionKey, NAMESPACE_NIL)

    // Get all registered students in this section
    const { data: allStudents, error: studentsError } = await supabase
      .from('student_face_registrations')
      .select('id, student_number, first_name, last_name')
      .eq('section_id', sectionId)
      .eq('is_active', true)

    if (studentsError) {
      console.error('Error fetching students:', studentsError)
      return NextResponse.json({ error: 'Failed to fetch students' }, { status: 400 })
    }

    if (!allStudents || allStudents.length === 0) {
      return NextResponse.json({
        success: true,
        markedAbsent: 0,
        message: 'No students registered in this section'
      })
    }

    // Get students who already have attendance records today
    const { data: existingRecords, error: recordsError } = await supabase
      .from('attendance_records')
      .select('student_number')
      .eq('attendance_session_id', sessionId)

    if (recordsError) {
      console.error('Error fetching existing records:', recordsError)
      return NextResponse.json({ error: 'Failed to fetch existing records' }, { status: 400 })
    }

    const markedStudentNumbers = new Set(
      (existingRecords || []).map(r => r.student_number)
    )

    // Find students without attendance records
    const absentStudents = allStudents.filter(
      s => !markedStudentNumbers.has(s.student_number)
    )

    if (absentStudents.length === 0) {
      return NextResponse.json({
        success: true,
        markedAbsent: 0,
        message: 'All students already have attendance records'
      })
    }

    // Insert absent records for all unscanned students
    const absentRecords = absentStudents.map(student => ({
      attendance_session_id: sessionId,
      student_registration_id: student.id,
      student_number: student.student_number,
      checked_in_at: new Date().toISOString(),
      face_match_confidence: null,
      status: 'absent',
      section_id: sectionId,
      notes: 'Auto-marked absent at attendance lock'
    }))

    const { error: insertError } = await supabase
      .from('attendance_records')
      .insert(absentRecords)

    if (insertError) {
      console.error('Error inserting absent records:', insertError)
      return NextResponse.json({ error: 'Failed to mark absences' }, { status: 400 })
    }

    console.log(`✅ Marked ${absentStudents.length} students as absent in section ${sectionId}`)

    return NextResponse.json({
      success: true,
      markedAbsent: absentStudents.length,
      absentStudents: absentStudents.map(s => ({
        studentNumber: s.student_number,
        name: `${s.first_name} ${s.last_name}`
      }))
    })
  } catch (error) {
    console.error('Error marking absences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
