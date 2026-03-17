import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'
import { getAllOfflineSections, getAllOfflineClassrooms, upsertOfflineSections, upsertOfflineClassrooms, upsertOfflineSchedules } from '@/app/api/_utils/offline-kiosk-cache'

async function readScheduleId(request: NextRequest): Promise<string | null> {
  const idFromQuery = request.nextUrl.searchParams.get('id')
  if (idFromQuery) return idFromQuery

  try {
    const body = await request.json()
    const idFromBody = body?.id
    return typeof idFromBody === 'string' && idFromBody.trim() ? idFromBody : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()

    let sessionsData: any[] = []
    let sectionsData: any[] = []
    let professorsData: any[] = []
    let usingOfflineCache = false

    try {
      // Fetch class sessions with professor and section details using service role
      const { data, error: sessionsError } = await supabase
        .from('class_sessions')
        .select(`
          id,
          section_id,
          professor_id,
          room,
          day_of_week,
          start_time,
          end_time,
          max_capacity,
          sections (
            id,
            section_code
          ),
          users (
            id,
            first_name,
            last_name
          )
        `)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true })

      if (sessionsError) {
        throw sessionsError
      }
      sessionsData = data || []

      // Fetch sections
      const { data: sections, error: sectionsError } = await supabase
        .from('sections')
        .select('id, section_code')
        .order('section_code', { ascending: true })

      if (sectionsError) {
        throw sectionsError
      }
      sectionsData = sections || []

      // Fetch professors
      const { data: professors, error: professorsError } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('role', 'professor')
        .order('first_name', { ascending: true })

      if (professorsError) {
        throw professorsError
      }
      professorsData = professors || []

      // Save to offline cache (both classrooms and schedules arrays for consistency)
      if (sessionsData.length > 0) {
        const offlineClassrooms = (sessionsData as any[]).map((s) => ({
          id: s.id,
          sectionId: s.section_id,
          room: s.room,
          maxCapacity: s.max_capacity,
          dayOfWeek: s.day_of_week,
          startTime: s.start_time,
          endTime: s.end_time,
          subjectCode: '',
          subjectName: '',
          sectionCode: s.sections?.section_code || '',
          professorId: s.professor_id,
        }))
        
        // Query actual student counts for each session
        const offlineSchedulesWithCounts = await Promise.all(
          (sessionsData as any[]).map(async (s) => {
            const { count } = await supabase
              .from('student_face_registrations')
              .select('id', { count: 'exact', head: true })
              .eq('section_id', s.section_id)
            
            return {
              id: s.id,
              professorId: s.professor_id,
              sectionId: s.section_id,
              sectionCode: s.sections?.section_code || '',
              room: s.room,
              dayOfWeek: s.day_of_week,
              startTime: s.start_time,
              endTime: s.end_time,
              totalStudents: count || 0, // Use actual count
              semester: s.sections?.semester,
              academicYear: s.sections?.academic_year,
            }
          })
        )

        await upsertOfflineClassrooms(offlineClassrooms)
        await upsertOfflineSchedules(offlineSchedulesWithCounts)
        console.log('📦 Saved', offlineClassrooms.length, 'classrooms to offline cache')
      }

      if (sectionsData.length > 0) {
        const offlineSections = (sectionsData as any[]).map((s) => ({
          id: s.id,
          sectionCode: s.section_code,
          semester: '',
          academicYear: '',
          maxStudents: 0,
        }))
        await upsertOfflineSections(offlineSections)
        console.log('📦 Saved', offlineSections.length, 'sections to offline cache')
      }
    } catch (dbError) {
      console.warn('⚠️ Supabase unavailable, using offline cache:', dbError)
      usingOfflineCache = true
      
      // Load from offline cache
      const offlineClassrooms = await getAllOfflineClassrooms()
      const offlineSections = await getAllOfflineSections()
      
      sessionsData = (offlineClassrooms as any[]).map((c) => ({
        id: c.id,
        section_id: c.sectionId,
        section_code: c.sectionCode,
        professor_id: c.professorId,
        professor_name: 'Cached',
        room: c.room,
        day_of_week: c.dayOfWeek,
        start_time: c.startTime,
        end_time: c.endTime,
        max_capacity: c.maxCapacity,
        sections: { id: c.sectionId, section_code: c.sectionCode },
        users: { id: c.professorId, first_name: '', last_name: '' }
      }))
      
      sectionsData = offlineSections.map((s) => ({
        id: s.id,
        section_code: s.sectionCode
      }))
      
      console.log('📦 Loaded', sessionsData.length, 'class sessions and', sectionsData.length, 'sections from offline cache')
    }

    // Format sessions data
    const formattedSessions = (sessionsData || []).map((session: any) => ({
      id: session.id,
      section_id: session.section_id,
      section_code: session.sections?.section_code || 'N/A',
      professor_id: session.professor_id,
      professor_name: session.users ? `${session.users.first_name} ${session.users.last_name}` : 'N/A',
      room: session.room,
      day_of_week: session.day_of_week,
      start_time: session.start_time,
      end_time: session.end_time,
      max_capacity: session.max_capacity
    }))

    return NextResponse.json({
      classSessions: formattedSessions,
      sections: sectionsData || [],
      professors: professorsData || [],
      usingOfflineCache
    })
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()
    const id = await readScheduleId(request)

    if (!id) {
      return NextResponse.json({ error: 'Missing schedule id' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('class_sessions')
      .delete()
      .eq('id', id)
      .select('id')

    if (error) {
      // Common case: FK constraint prevents delete if there are dependent rows.
      const status = error.code === '23503' ? 409 : 500
      return NextResponse.json(
        { error: 'Failed to delete schedule', details: error },
        { status }
      )
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const deletedId = (data as any[])?.[0]?.id ?? id
    return NextResponse.json({ ok: true, deletedId })
  } catch (error) {
    console.error('API Error (DELETE /api/admin/schedules):', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
