import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SchedulePayload {
  subjectCode: string
  subjectName: string
  dayOfWeek: string
  startTime: string
  endTime: string
  room: string
}

interface StudentPayload {
  studentNumber: string
  firstName: string
  lastName: string
  middleName: string | null
  email: string
}

interface SectionPayload {
  sectionCode: string
  semester: string
  academicYear: string
  yearLevel: string
  schedules: SchedulePayload[]
  students: StudentPayload[]
}

interface UploadBody {
  professorId: string
  sections: SectionPayload[]
}

// ── POST Handler ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: UploadBody = await request.json()
    const { professorId, sections } = body

    if (!professorId || !sections || sections.length === 0) {
      return NextResponse.json(
        { error: 'professorId and at least one section are required' },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Verify professor exists
    const { data: professor, error: profError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', professorId)
      .single()

    if (profError || !professor) {
      return NextResponse.json({ error: 'Professor not found' }, { status: 404 })
    }

    const results = {
      sectionsCreated: 0,
      sectionsExisting: 0,
      classSessionsCreated: 0,
      studentsCreated: 0,
      studentsExisting: 0,
      errors: [] as string[],
    }

    for (const sectionPayload of sections) {
      try {
        // ── 1. Upsert Section ────────────────────────────────────────────────
        // Check if section already exists by section_code
        const { data: existingSection } = await supabase
          .from('sections')
          .select('id')
          .eq('section_code', sectionPayload.sectionCode)
          .maybeSingle()

        let sectionId: string

        if (existingSection) {
          sectionId = existingSection.id
          results.sectionsExisting++
        } else {
          const { data: newSection, error: sectionError } = await supabase
            .from('sections')
            .insert({
              section_code: sectionPayload.sectionCode,
              semester: sectionPayload.semester,
              academic_year: sectionPayload.academicYear,
              max_students: sectionPayload.students.length,
            })
            .select('id')
            .single()

          if (sectionError) {
            results.errors.push(`Section ${sectionPayload.sectionCode}: ${sectionError.message}`)
            continue
          }
          sectionId = newSection.id
          results.sectionsCreated++
        }

        // ── 2. Create Class Sessions (schedule entries) ──────────────────────
        for (const schedule of sectionPayload.schedules) {
          // Check for existing class session with same section + professor + day + time
          const { data: existingSession } = await supabase
            .from('class_sessions')
            .select('id')
            .eq('section_id', sectionId)
            .eq('professor_id', professorId)
            .eq('day_of_week', schedule.dayOfWeek)
            .eq('start_time', schedule.startTime)
            .eq('end_time', schedule.endTime)
            .maybeSingle()

          if (!existingSession) {
            const { error: sessionError } = await supabase
              .from('class_sessions')
              .insert({
                section_id: sectionId,
                professor_id: professorId,
                room: schedule.room,
                max_capacity: sectionPayload.students.length,
                day_of_week: schedule.dayOfWeek,
                start_time: schedule.startTime,
                end_time: schedule.endTime,
                subject_code: schedule.subjectCode || null,
                subject_name: schedule.subjectName || null,
              })

            if (sessionError) {
              results.errors.push(
                `Schedule ${sectionPayload.sectionCode} ${schedule.dayOfWeek}: ${sessionError.message}`
              )
            } else {
              results.classSessionsCreated++
            }
          }
        }

        // ── 3. Create Students (face registrations without face data) ────────
        for (const student of sectionPayload.students) {
          try {
            // Check if student_face_registrations already has this student
            const { data: existingReg } = await supabase
              .from('student_face_registrations')
              .select('id, section_id, email, middle_name')
              .eq('student_number', student.studentNumber)
              .maybeSingle()

            if (existingReg) {
              // Update section_id and email if changed/missing
              const updateFields: Record<string, any> = {}
              if (existingReg.section_id !== sectionId) updateFields.section_id = sectionId
              if (student.email) updateFields.email = student.email
              if (student.middleName) updateFields.middle_name = student.middleName
              if (Object.keys(updateFields).length > 0) {
                await supabase
                  .from('student_face_registrations')
                  .update(updateFields)
                  .eq('id', existingReg.id)
              }
              results.studentsExisting++
            } else {
              // Insert new student face registration (without face data)
              const { error: regError } = await supabase
                .from('student_face_registrations')
                .insert({
                  student_number: student.studentNumber,
                  first_name: student.firstName,
                  last_name: student.lastName,
                  middle_name: student.middleName || null,
                  email: student.email || null,
                  face_data: 'pending',        // placeholder — student registers face later
                  face_descriptor: null,
                  section_id: sectionId,
                  is_active: true,
                })

              if (regError) {
                results.errors.push(
                  `Student ${student.studentNumber}: ${regError.message}`
                )
              } else {
                results.studentsCreated++
              }
            }
          } catch (studentErr: any) {
            results.errors.push(
              `Student ${student.studentNumber}: ${studentErr.message}`
            )
          }
        }
      } catch (sectionErr: any) {
        results.errors.push(
          `Section ${sectionPayload.sectionCode}: ${sectionErr.message}`
        )
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error: any) {
    console.error('Upload class list error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
