import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { upsertOfflineClassrooms, upsertOfflineSchedules, upsertOfflineStudents } from '@/app/api/_utils/offline-kiosk-cache'

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
      .select('id, section_code, semester, academic_year')
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

    // Update offline cache with new classroom (for both classrooms and schedules arrays)
    try {
      const offlineClassroom = {
        id: classSession.id,
        sectionId: sectionId,
        room: room,
        maxCapacity: parseInt(maxCapacity),
        dayOfWeek: dayOfWeek,
        startTime: startTime,
        endTime: endTime,
        subjectCode: subjectCode || '',
        subjectName: subjectName || '',
        sectionCode: section.section_code,
        semester: section.semester,
        academicYear: section.academic_year,
        professorId: professorId,
      }

      // Save to classrooms array for immediate availability in offline cache
      await upsertOfflineClassrooms([offlineClassroom])
      
      // Also save to schedules array so kiosk can find it when offline
      // Query actual student count first
      const { count: studentCount } = await supabase
        .from('student_face_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('section_id', sectionId)

      await upsertOfflineSchedules([{
        id: classSession.id,
        professorId: professorId,
        sectionId: sectionId,
        sectionCode: section.section_code,
        room: room,
        dayOfWeek: dayOfWeek,
        startTime: startTime,
        endTime: endTime,
        totalStudents: studentCount || 0, // Use actual count instead of hardcoding 0
        semester: section.semester,
        academicYear: section.academic_year,
      }])
      
      console.log('✅ Classroom added to both offline cache arrays:', classSession.id)

      // Fetch and cache face encodings for this section so they're available offline immediately
      try {
        const { data: students, error: studentsError } = await supabase
          .from('student_face_registrations')
          .select('id, student_number, first_name, last_name, face_descriptor, is_active')
          .eq('section_id', sectionId)
          .eq('is_active', true)

        if (!studentsError && students && students.length > 0) {
          // Normalize and filter students with valid face descriptors
          const validStudents = students
            .map((s: any) => {
              let embedding = s.face_descriptor
              if (embedding && typeof embedding === 'object' && !Array.isArray(embedding)) {
                embedding = Object.values(embedding)
              }
              const normalizedEmbedding = Array.isArray(embedding)
                ? embedding.map((value: any) => Number(value))
                : undefined

              return {
                id: String(s.id),
                studentNumber: String(s.student_number || ''),
                firstName: String(s.first_name || ''),
                lastName: String(s.last_name || ''),
                sectionId: String(sectionId),
                faceDescriptor: normalizedEmbedding,
                isActive: s.is_active !== false,
              }
            })
            .filter((s: any) => Array.isArray(s.faceDescriptor) && s.faceDescriptor.length === 512)

          if (validStudents.length > 0) {
            // Cache students with face descriptors for offline use
            await upsertOfflineStudents(validStudents)
            console.log(`📚 Cached ${validStudents.length} students with face descriptors for section ${sectionId}`)
          }
        }
      } catch (faceCacheErr) {
        console.warn('⚠️ Failed to cache face encodings for new classroom:', faceCacheErr)
        // Don't fail the request if face caching fails
      }
    } catch (cacheError) {
      console.warn('⚠️ Failed to write offline classroom cache:', cacheError)
      // Don't fail the request if cache write fails
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
