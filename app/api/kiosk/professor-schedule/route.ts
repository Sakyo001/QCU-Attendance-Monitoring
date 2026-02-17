import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

/**
 * Get professor's class schedules for today.
 * Used by the kiosk after professor face recognition to find active classes.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)
    const professorId = searchParams.get('professorId')

    if (!professorId) {
      return NextResponse.json({ error: 'professorId required' }, { status: 400 })
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

    // Fetch professor's class sessions for today
    const { data: sessions, error } = await supabase
      .from('class_sessions')
      .select('id, section_id, room, max_capacity, day_of_week, start_time, end_time, sections(id, section_code, semester, academic_year)')
      .eq('professor_id', professorId)
      .eq('day_of_week', today)
      .order('start_time')

    if (error) {
      console.error('Error fetching professor schedule:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({
        success: true,
        schedules: [],
        message: `No classes scheduled for ${today}`
      })
    }

    // For each session, get student count
    const schedulesWithStudents = await Promise.all(
      sessions.map(async (session: any) => {
        const { count } = await supabase
          .from('student_face_registrations')
          .select('id', { count: 'exact', head: true })
          .eq('section_id', session.section_id)

        return {
          id: session.id,
          sectionId: session.section_id,
          sectionCode: session.sections?.section_code || 'Unknown',
          room: session.room,
          dayOfWeek: session.day_of_week,
          startTime: session.start_time,
          endTime: session.end_time,
          totalStudents: count || 0,
          semester: session.sections?.semester,
          academicYear: session.sections?.academic_year
        }
      })
    )

    return NextResponse.json({
      success: true,
      schedules: schedulesWithStudents
    })
  } catch (error) {
    console.error('Error fetching professor schedule:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
