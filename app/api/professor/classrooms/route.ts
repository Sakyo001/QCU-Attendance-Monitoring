import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const professorId = searchParams.get('professorId')

    if (!professorId) {
      return NextResponse.json(
        { error: 'professorId is required' },
        { status: 400 }
      )
    }

    // Use service role client (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Fetch professor's class sessions with section details
    const { data: classrooms, error } = await supabase
      .from('class_sessions')
      .select('id, section_id, room, max_capacity, day_of_week, start_time, end_time, sections(id, section_code, semester, academic_year, max_students)')
      .eq('professor_id', professorId)
      .order('day_of_week')

    if (error) {
      console.error('Error fetching classrooms:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      classrooms: classrooms || [],
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
