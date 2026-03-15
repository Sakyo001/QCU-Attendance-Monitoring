import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    // professorId is accepted for backwards-compat but sections are treated as global.
    // (Some deployments do not have `sections.professor_id`.)
    const { searchParams } = new URL(request.url)
    void searchParams.get('professorId')

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: sections, error } = await supabase
      .from('sections')
      .select('id, section_code, semester, academic_year, max_students')
      .order('section_code')

    if (error) {
      console.error('Error fetching sections:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, sections: sections || [] })
  } catch (error: any) {
    console.error('Unexpected error fetching sections:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
