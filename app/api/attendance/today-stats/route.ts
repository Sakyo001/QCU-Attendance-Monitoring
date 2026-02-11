import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)
    const sectionId = searchParams.get('sectionId')

    if (!sectionId) {
      return NextResponse.json({ error: 'sectionId required' }, { status: 400 })
    }

    const todayDate = new Date().toISOString().split('T')[0]
    const sessionKey = `attendance-${sectionId}-${todayDate}`
    const sessionId = uuidv5(sessionKey, NAMESPACE_NIL)

    // Count present records for today
    const { data: records, error } = await supabase
      .from('attendance_records')
      .select('id, status')
      .eq('attendance_session_id', sessionId)

    if (error) {
      console.error('Error fetching today stats:', error)
      return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 400 })
    }

    const present = records?.filter(r => r.status === 'present').length || 0
    const late = records?.filter(r => r.status === 'late').length || 0

    // Get total registered students for this section
    const { count: totalStudents } = await supabase
      .from('student_face_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('section_id', sectionId)

    const total = totalStudents || 0
    const absent = Math.max(0, total - present - late)

    return NextResponse.json({
      success: true,
      present,
      late,
      absent,
      total
    })
  } catch (error) {
    console.error('Error fetching today stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
