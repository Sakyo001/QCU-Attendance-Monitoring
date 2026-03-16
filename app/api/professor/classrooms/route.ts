import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { 
  getOfflineClassroomsForProfessor, 
  upsertOfflineClassrooms,
  deleteOfflineSection
} from '@/app/api/_utils/offline-kiosk-cache'

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

    try {
      // Fetch professor's class sessions with section details
      const { data: classrooms, error } = await supabase
        .from('class_sessions')
        .select('id, section_id, room, max_capacity, day_of_week, start_time, end_time, subject_code, subject_name, sections(id, section_code, semester, academic_year, max_students)')
        .eq('professor_id', professorId)
        .order('day_of_week')

      if (error) {
        throw error
      }

      console.log('✅ Fetched', classrooms?.length || 0, 'classrooms from Supabase for professor:', professorId)

      // Transform and save to offline cache
      if (classrooms && classrooms.length > 0) {
        const offlineClassrooms = (classrooms as any[]).map((c) => ({
          id: c.id,
          sectionId: c.section_id,
          room: c.room,
          maxCapacity: c.max_capacity,
          dayOfWeek: c.day_of_week,
          startTime: c.start_time,
          endTime: c.end_time,
          subjectCode: c.subject_code,
          subjectName: c.subject_name,
          sectionCode: c.sections?.section_code || '',
          semester: c.sections?.semester,
          academicYear: c.sections?.academic_year,
          professorId,
        }))
        await upsertOfflineClassrooms(offlineClassrooms)
        console.log('📦 Saved', offlineClassrooms.length, 'classrooms to offline cache')

        // Sync deletions: remove classrooms that exist in cache but not in new data
        const cachedClassrooms = await getOfflineClassroomsForProfessor(professorId)
        const onlineIds = new Set((classrooms as any[]).map((c) => c.id))
        
        for (const cached of cachedClassrooms) {
          if (!onlineIds.has(cached.id)) {
            console.log('🗑️ Removing deleted classroom from offline cache:', cached.id)
            await deleteOfflineSection(cached.sectionId)
          }
        }
      } else {
        // Supabase returned empty and request succeeded.
        // Treat this as authoritative (all classrooms removed online),
        // and clear professor-related cached classrooms to avoid stale UI.
        const cachedClassrooms = await getOfflineClassroomsForProfessor(professorId)
        if (cachedClassrooms.length > 0) {
          console.log('🧹 Supabase returned empty; clearing', cachedClassrooms.length, 'stale cached classrooms')
          for (const cached of cachedClassrooms) {
            await deleteOfflineSection(cached.sectionId)
          }
        }
      }

      return NextResponse.json({
        success: true,
        classrooms: classrooms || [],
      }, { status: 200 })
    } catch (dbError) {
      console.warn('⚠️ Supabase unavailable, using offline classroom cache:', dbError)
      
      // Fallback to offline cache
      const offlineClassrooms = await getOfflineClassroomsForProfessor(professorId)
      console.log('📦 Loaded', offlineClassrooms.length, 'classrooms from offline cache')
      
      // Transform offline classrooms back to expected format
      const transformedClassrooms = offlineClassrooms.map((c) => ({
        id: c.id,
        section_id: c.sectionId,
        room: c.room,
        max_capacity: c.maxCapacity,
        day_of_week: c.dayOfWeek,
        start_time: c.startTime,
        end_time: c.endTime,
        subject_code: c.subjectCode,
        subject_name: c.subjectName,
        sections: {
          id: c.sectionId,
          section_code: c.sectionCode,
          semester: c.semester,
          academic_year: c.academicYear,
        },
      }))
      
      return NextResponse.json({
        success: true,
        classrooms: transformedClassrooms,
        usingOfflineCache: true,
      })
    }
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
