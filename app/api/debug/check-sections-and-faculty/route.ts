import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Check sections table
    const { data: sections, error: sectionsError } = await supabase
      .from('sections')
      .select('*')
      .order('created_at', { ascending: false })

    // Check section_professors table
    const { data: assignments, error: assignmentsError } = await supabase
      .from('section_professors')
      .select('*')

    return NextResponse.json({
      success: true,
      sections: {
        count: sections?.length || 0,
        data: sections || [],
        error: sectionsError?.message
      },
      section_professors: {
        count: assignments?.length || 0,
        data: assignments || [],
        error: assignmentsError?.message
      }
    })
  } catch (error: any) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
