import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { 
  getAllOfflineSchedules,
  getOfflineSchedulesByDay,
  getOfflineSchedulesForProfessorAll,
  upsertOfflineSchedules
} from '@/app/api/_utils/offline-kiosk-cache'

interface SessionRow {
  id: string
  section_id: string
  professor_id: string
  room: string
  day_of_week: string
  start_time: string
  end_time: string
  sections?: {
    id: string
    section_code: string
    semester?: string
    academic_year?: string
  } | null
}

interface KioskSchedule {
  id: string
  professorId: string
  sectionId: string
  sectionCode: string
  room: string
  dayOfWeek: string
  startTime: string
  endTime: string
  totalStudents: number
  semester?: string
  academicYear?: string
}

/**
 * Get kiosk schedules for today.
 * - Professor mode: requires professorId
 * - Representative mode: returns all schedules for manual selection
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const professorId = searchParams.get('professorId')
    const mode = String(searchParams.get('mode') || '').toLowerCase()
    const representativeMode = mode === 'representative' || searchParams.get('bypass') === '1'

    if (!representativeMode && !professorId) {
      return NextResponse.json({ error: 'professorId required' }, { status: 400 })
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

    let schedulesWithStudents: KioskSchedule[] = []
    let usedOfflineCache = false

    try {
      const supabase = getSupabaseAdmin()

      let query = supabase
        .from('class_sessions')
        .select('id, section_id, professor_id, room, max_capacity, day_of_week, start_time, end_time, sections(id, section_code, semester, academic_year)')
        .order('day_of_week')
        .order('start_time')

      if (!representativeMode) {
        query = query.eq('professor_id', professorId)
      }

      // Fetch complete schedule list for cache hydration.
      // We still return today's schedules for online mode UI behavior.
      const { data: sessions, error } = await query

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
        ((sessions || []) as SessionRow[]).map(async (session) => {
          const { count } = await supabase
            .from('student_face_registrations')
            .select('id', { count: 'exact', head: true })
            .eq('section_id', session.section_id)

          return {
            id: session.id,
            professorId: session.professor_id,
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
          professorId: s.professorId,
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
    } catch (error: unknown) {
      console.warn('⚠️ Online schedule fetch failed, using offline cache:', error)
      usedOfflineCache = true

      if (representativeMode) {
        // Prefer today's schedules, but if cache is stale allow all cached schedules.
        const cachedToday = await getOfflineSchedulesByDay(today)
        const cached = cachedToday.length > 0 ? cachedToday : await getAllOfflineSchedules()
        schedulesWithStudents = cached.map((s) => ({
          id: s.id,
          professorId: s.professorId,
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
        console.log('📦 Loaded', cached.length, 'schedules from offline cache for representative mode')
      } else {
        // In offline mode, get ALL schedules for professor (not just today)
        // so classes remain selectable even if day labels are stale.
        const cached = await getOfflineSchedulesForProfessorAll(professorId || '')
        schedulesWithStudents = cached.map((s) => ({
          id: s.id,
          professorId: s.professorId,
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
    }

    if (schedulesWithStudents.length === 0) {
      return NextResponse.json({
        success: true,
        schedules: [],
        message: usedOfflineCache
          ? representativeMode
            ? 'No cached classes available for representative mode'
            : `No cached classes available for ${today}`
          : `No classes scheduled for ${today}`
      })
    }

    return NextResponse.json({
      success: true,
      schedules: schedulesWithStudents,
      source: usedOfflineCache ? 'offline-cache' : 'supabase',
      mode: representativeMode ? 'representative' : 'professor',
    })
  } catch (error) {
    console.error('Error fetching professor schedule:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
