import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const studentId = request.nextUrl.searchParams.get('studentId')

    if (!studentId) {
      return NextResponse.json({ 
        error: 'Student ID is required' 
      }, { status: 400 })
    }

    // Get the student_number from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('student_id, email, first_name, last_name')
      .eq('id', studentId)
      .single()

    if (userError || !userData) {
      return NextResponse.json({ 
        error: 'Student not found',
        details: userError?.message
      })
    }

    const studentNumber = userData.student_id

    // Get attendance records
    const { data: attendanceRecords } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('student_number', studentNumber)

    // Get face registrations
    const { data: faceRegistrations } = await supabase
      .from('student_face_registrations')
      .select('*')
      .eq('student_number', studentNumber)

    // Get section details if we have a section_id
    let sectionDetails = null
    if (faceRegistrations?.[0]?.section_id) {
      const { data: section } = await supabase
        .from('sections')
        .select('*')
        .eq('id', faceRegistrations[0].section_id)
        .single()
      sectionDetails = section
    }

    return NextResponse.json({
      student: userData,
      attendanceRecords: attendanceRecords || [],
      faceRegistrations: faceRegistrations || [],
      sectionDetails: sectionDetails || null,
      debug: {
        studentNumberUsed: studentNumber,
        attendanceRecordsCount: attendanceRecords?.length || 0,
        faceRegistrationsCount: faceRegistrations?.length || 0,
        hasSectionInFaceReg: !!faceRegistrations?.[0]?.section_id,
        sectionIdInFaceReg: faceRegistrations?.[0]?.section_id || 'NULL',
        firstAttendanceSectionId: attendanceRecords?.[0]?.section_id || 'NULL'
      }
    })
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message
    }, { status: 500 })
  }
}
