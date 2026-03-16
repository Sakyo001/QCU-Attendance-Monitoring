import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { 
  getOfflineSchedulesForProfessorAll,
  upsertOfflineSchedules
} from '@/app/api/_utils/offline-kiosk-cache'

/**
 * Get professor's class schedules for today.
 * Used by the kiosk after professor face recognition to find active classes.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const professorId = searchParams.get('professorId')

    if (!professorId) {
      return NextResponse.json({ error: 'professorId required' }, { status: 400 })
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

    let schedulesWithStudents: any[] = []
    let usedOfflineCache = false

    try {
      const supabase = getSupabaseAdmin()

      // Fetch ALL professor sessions so offline cache is always complete.
      // We still return today's schedules for online mode UI behavior.
      const { data: sessions, error } = await supabase
        .from('class_sessions')
        .select('id, section_id, room, max_capacity, day_of_week, start_time, end_time, sections(id, section_code, semester, academic_year)')
        .eq('professor_id', professorId)
        .order('day_of_week')
        .order('start_time')

      if (error) {
        throw error
      }

      if (!sessions || sessions.length === 0) {
        return NextResponse.json({
          success: true,
          schedules: [],
          message: `No classes scheduled for ${today}`
        })
      }

      // Build complete schedule list (all days) for cache hydration.
      const allSchedulesWithStudents = await Promise.all(
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

      // Keep a local copy for offline kiosk schedule selection.
      await upsertOfflineSchedules(
        allSchedulesWithStudents.map((s) => ({
          id: s.id,
          professorId,
          sectionId: s.sectionId,
          sectionCode: s.sectionCode,
          room: s.room,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          totalStudents: s.totalStudents,
          semester: s.semester,
          academicYear: s.academicYear,
        }))
      )

      // Online mode keeps the current UX: show only today's schedules.
      schedulesWithStudents = allSchedulesWithStudents.filter((s) => s.dayOfWeek === today)
    } catch (error: any) {
      console.warn('⚠️ Online schedule fetch failed, using offline cache:', error)
      usedOfflineCache = true
      
      // In offline mode, get ALL schedules for professor (not just today)
      // This allows viewing schedules even if today's day_of_week doesn't match cached schedules
      const cached = await getOfflineSchedulesForProfessorAll(professorId)
      schedulesWithStudents = cached.map((s) => ({
        id: s.id,
        sectionId: s.sectionId,
        sectionCode: s.sectionCode,
        room: s.room,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        totalStudents: s.totalStudents,
        semester: s.semester,
        academicYear: s.academicYear,
      }))
      console.log('📦 Loaded', cached.length, 'schedules from offline cache for professor:', professorId)
    }

    if (schedulesWithStudents.length === 0) {
      return NextResponse.json({
        success: true,
        schedules: [],
        message: usedOfflineCache
          ? `No cached classes available for ${today}`
          : `No classes scheduled for ${today}`
      })
    }

    return NextResponse.json({
      success: true,
      schedules: schedulesWithStudents,
      source: usedOfflineCache ? 'offline-cache' : 'supabase',
    })
  } catch (error) {
    console.error('Error fetching professor schedule:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
