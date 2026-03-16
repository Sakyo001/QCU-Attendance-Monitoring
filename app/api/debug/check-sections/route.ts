import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { getAllOfflineSections, upsertOfflineSections } from '@/app/api/_utils/offline-kiosk-cache'

export async function GET() {
  try {
    const cookieStore = cookies()
    const supabase = createClient(cookieStore as any)
    
    try {
      // Get all sections
      const { data: sections, error } = await supabase
        .from('sections')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (error) {
        throw error
      }
      
      // Save to offline cache
      if (sections && sections.length > 0) {
        const offlineSections = (sections as any[]).map((s) => ({
          id: s.id,
          sectionCode: s.section_code || '',
          semester: s.semester || '',
          academicYear: s.academic_year || '',
          maxStudents: s.max_students || 0,
        }))
        await upsertOfflineSections(offlineSections)
        console.log('📦 Saved', offlineSections.length, 'sections to offline cache')
      }
      
      return NextResponse.json({
        success: true,
        count: sections?.length || 0,
        sections: sections || []
      })
    } catch (dbError) {
      console.warn('⚠️ Supabase unavailable, using offline section cache:', dbError)
      
      // Load from offline cache
      const offlineSections = await getAllOfflineSections()
      const sections = offlineSections.map((s) => ({
        id: s.id,
        section_code: s.sectionCode,
        semester: s.semester,
        academic_year: s.academicYear,
        max_students: s.maxStudents,
      }))
      
      console.log('📦 Loaded', sections.length, 'sections from offline cache')
      
      return NextResponse.json({
        success: true,
        count: sections?.length || 0,
        sections: sections || [],
        usingOfflineCache: true
      })
    }
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Unexpected error', details: error.message },
      { status: 500 }
    )
  }
}
