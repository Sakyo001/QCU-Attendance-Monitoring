import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const sessionId = request.nextUrl.searchParams.get('sessionId')
    
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    // Get raw attendance records
    const { data: rawRecords, error: rawError } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('attendance_session_id', sessionId)

    // Get registered students for comparison
    const { data: students, error: studentsError } = await supabase
      .from('student_face_registrations')
      .select('id, first_name, last_name, student_number')
      .limit(5)

    return NextResponse.json({
      sessionId,
      attendanceRecords: rawRecords || [],
      attendanceCount: rawRecords?.length || 0,
      registeredStudents: students || [],
      errors: {
        rawRecordsError: rawError?.message,
        studentsError: studentsError?.message
      }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
