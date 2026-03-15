import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

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

    // Fetch class sessions with professor and section details using service role
    const { data: sessionsData, error: sessionsError } = await supabase
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
      console.error('Error fetching class sessions:', sessionsError)
      return NextResponse.json(
        { error: 'Failed to fetch schedules', details: sessionsError },
        { status: 500 }
      )
    }

    // Fetch sections
    const { data: sectionsData, error: sectionsError } = await supabase
      .from('sections')
      .select('id, section_code')
      .order('section_code', { ascending: true })

    if (sectionsError) {
      console.error('Error fetching sections:', sectionsError)
      return NextResponse.json(
        { error: 'Failed to fetch sections', details: sectionsError },
        { status: 500 }
      )
    }

    // Fetch professors
    const { data: professorsData, error: professorsError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .eq('role', 'professor')
      .order('first_name', { ascending: true })

    if (professorsError) {
      console.error('Error fetching professors:', professorsError)
      return NextResponse.json(
        { error: 'Failed to fetch professors', details: professorsError },
        { status: 500 }
      )
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
      professors: professorsData || []
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
