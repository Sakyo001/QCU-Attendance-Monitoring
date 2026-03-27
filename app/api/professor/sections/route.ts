import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAllOfflineSections, upsertOfflineSections } from '@/app/api/_utils/offline-kiosk-cache'

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

    try {
      const { data: sections, error } = await supabase
        .from('sections')
        .select('id, section_code, semester, academic_year, max_students')
        .order('section_code')

      if (error) {
        throw error
      }

      const dedupedSections = Array.from(
        new Map(
          (sections || []).map((s: any) => [
            `${s.section_code}|${s.semester}|${s.academic_year}`,
            s,
          ])
        ).values()
      )

      // Save to offline cache
      if (dedupedSections.length > 0) {
        const offlineSections = dedupedSections.map((s: any) => ({
          id: s.id,
          sectionCode: s.section_code,
          semester: s.semester,
          academicYear: s.academic_year,
          maxStudents: s.max_students,
        }))
        await upsertOfflineSections(offlineSections)
        console.log('📦 Saved', offlineSections.length, 'sections to offline cache')
      }

      return NextResponse.json({ success: true, sections: dedupedSections })
    } catch (dbError) {
      console.warn('⚠️ Supabase unavailable, using offline section cache:', dbError)
      
      // Fallback to offline cache
      const offlineSections = await getAllOfflineSections()
      console.log('📦 Loaded', offlineSections.length, 'sections from offline cache')
      
      return NextResponse.json({ 
        success: true, 
        sections: offlineSections,
        usingOfflineCache: true,
      })
    }
  } catch (error: any) {
    console.error('Unexpected error fetching sections:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
