import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)
    const sectionId = searchParams.get('sectionId')
    const scheduleId = searchParams.get('scheduleId')

    if (!sectionId) {
      return NextResponse.json({ error: 'sectionId required' }, { status: 400 })
    }

    // Get class session info
    let query = supabase
      .from('class_sessions')
      .select('id, section_id, room, max_capacity, day_of_week, start_time, end_time, sections(section_code, semester, academic_year)')

    if (scheduleId) {
      query = query.eq('id', scheduleId)
    } else {
      query = query.eq('section_id', sectionId)
    }

    const { data: session, error } = await query.single()

    if (error || !session) {
      // If no specific schedule found, try to get any session for this section
      const { data: sessions } = await supabase
        .from('class_sessions')
        .select('id, section_id, room, max_capacity, day_of_week, start_time, end_time, sections(section_code, semester, academic_year)')
        .eq('section_id', sectionId)
        .limit(1)

      if (!sessions || sessions.length === 0) {
        return NextResponse.json({
          success: true,
          classInfo: null,
          locked: false,
          totalStudents: 0
        })
      }

      const s = sessions[0] as any
      const locked = isAttendanceLocked(s.start_time, s.day_of_week)

      return NextResponse.json({
        success: true,
        classInfo: {
          id: s.id,
          section_code: s.sections?.section_code || sectionId,
          room: s.room,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          semester: s.sections?.semester,
          academic_year: s.sections?.academic_year
        },
        locked,
        totalStudents: s.max_capacity || 0
      })
    }

    const s = session as any
    const locked = isAttendanceLocked(s.start_time, s.day_of_week)

    // Get total registered students for this section
    const { count: totalStudents } = await supabase
      .from('student_face_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('section_id', sectionId)

    return NextResponse.json({
      success: true,
      classInfo: {
        id: s.id,
        section_code: s.sections?.section_code || sectionId,
        room: s.room,
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
        semester: s.sections?.semester,
        academic_year: s.sections?.academic_year
      },
      locked,
      totalStudents: totalStudents || s.max_capacity || 0
    })
  } catch (error) {
    console.error('Error fetching class info:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function isAttendanceLocked(startTime: string, dayOfWeek: string): boolean {
  const now = new Date()
  const today = now.toLocaleDateString('en-US', { weekday: 'long' })

  // Only enforce lock on the same day
  if (today !== dayOfWeek) return false

  // Parse start_time (e.g., "08:00:00" or "08:00")
  const [hours, minutes] = startTime.split(':').map(Number)
  const classStart = new Date(now)
  classStart.setHours(hours, minutes, 0, 0)

  // Lock after 30 minutes from start
  const lockTime = new Date(classStart.getTime() + 30 * 60 * 1000)

  return now > lockTime
}
