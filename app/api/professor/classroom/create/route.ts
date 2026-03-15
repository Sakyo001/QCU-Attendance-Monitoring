import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { professorId, sectionId, subjectCode, subjectName, room, maxCapacity, dayOfWeek, startTime, endTime } = body

    // Validate required fields
    if (!professorId || !sectionId || !room || !maxCapacity || !dayOfWeek || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Use service role client (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Validate section exists (sections are global)
    const { data: section, error: sectionError } = await supabase
      .from('sections')
      .select('id')
      .eq('id', sectionId)
      .maybeSingle()

    if (sectionError) {
      console.error('Error validating section ownership:', sectionError)
      return NextResponse.json(
        { error: 'Failed to validate section' },
        { status: 400 }
      )
    }

    if (!section) {
      return NextResponse.json(
        { error: 'Section not found' },
        { status: 404 }
      )
    }

    // Create class session record
    const { data: classSession, error: sessionError } = await supabase
      .from('class_sessions')
      .insert({
        section_id: sectionId,
        professor_id: professorId,
        room: room,
        max_capacity: parseInt(maxCapacity),
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        subject_code: subjectCode || null,
        subject_name: subjectName || null,
      })
      .select()
      .single()

    if (sessionError) {
      console.error('Class session creation error:', sessionError)
      return NextResponse.json(
        { error: sessionError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      classSessionId: classSession.id,
      message: 'Classroom created successfully',
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
