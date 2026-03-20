import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

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

function normalizeTime(value: string): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed
}

export async function POST(request: NextRequest) {
  try {
    const body: UploadBody = await request.json()
    const professorId = body.professorId?.trim()
    const sections = body.sections || []

    if (!professorId || sections.length === 0) {
      return NextResponse.json(
        { error: 'professorId and at least one section are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    const { data: professor, error: profError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', professorId)
      .single()

    if (profError || !professor) {
      return NextResponse.json({ error: 'Professor not found' }, { status: 404 })
    }

    if (professor.role !== 'professor') {
      return NextResponse.json({ error: 'Selected user is not a professor' }, { status: 400 })
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
        const { data: existingSection } = await supabase
          .from('sections')
          .select('id')
          .eq('section_code', sectionPayload.sectionCode)
          .eq('semester', sectionPayload.semester)
          .eq('academic_year', sectionPayload.academicYear)
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

        for (const schedule of sectionPayload.schedules) {
          const startTime = normalizeTime(schedule.startTime)
          const endTime = normalizeTime(schedule.endTime)

          if (!schedule.dayOfWeek || !startTime || !endTime || startTime >= endTime) {
            results.errors.push(
              `Schedule ${sectionPayload.sectionCode}: invalid day/time (${schedule.dayOfWeek} ${schedule.startTime}-${schedule.endTime})`
            )
            continue
          }

          const { data: existingSession } = await supabase
            .from('class_sessions')
            .select('id')
            .eq('section_id', sectionId)
            .eq('professor_id', professorId)
            .eq('day_of_week', schedule.dayOfWeek)
            .eq('start_time', startTime)
            .eq('end_time', endTime)
            .maybeSingle()

          if (!existingSession) {
            const { error: sessionError } = await supabase
              .from('class_sessions')
              .insert({
                section_id: sectionId,
                professor_id: professorId,
                room: schedule.room || 'TBA',
                max_capacity: sectionPayload.students.length,
                day_of_week: schedule.dayOfWeek,
                start_time: startTime,
                end_time: endTime,
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

        for (const student of sectionPayload.students) {
          try {
            const { data: existingUser } = await supabase
              .from('users')
              .select('id, email')
              .eq('student_id', student.studentNumber)
              .maybeSingle()

            let userId: string

            if (existingUser) {
              userId = existingUser.id
            } else {
              const generatedEmail = student.email || `${student.studentNumber}@student.edu`
              const { data: userByEmail } = await supabase
                .from('users')
                .select('id, student_id, email')
                .eq('email', generatedEmail)
                .maybeSingle()

              if (userByEmail) {
                if (userByEmail.student_id) {
                  results.errors.push(
                    `${student.studentNumber} (${student.firstName} ${student.lastName}): Email "${generatedEmail}" is already registered for student ${userByEmail.student_id}`
                  )
                } else {
                  results.errors.push(
                    `${student.studentNumber} (${student.firstName} ${student.lastName}): Email "${generatedEmail}" is already registered as admin or faculty`
                  )
                }
                continue
              }

              const { data: newUser, error: userError } = await supabase
                .from('users')
                .insert({
                  student_id: student.studentNumber,
                  first_name: student.firstName,
                  last_name: student.lastName,
                  email: generatedEmail,
                  role: 'student',
                  is_active: true,
                })
                .select('id')
                .single()

              if (userError) {
                results.errors.push(
                  `User creation for ${student.studentNumber}: ${userError.message}`
                )
                continue
              }

              userId = newUser.id
            }

            const { data: existingReg } = await supabase
              .from('student_face_registrations')
              .select('id, section_id, email, middle_name')
              .eq('student_number', student.studentNumber)
              .maybeSingle()

            if (existingReg) {
              const updateFields: Record<string, unknown> = {}
              if (existingReg.section_id !== sectionId) updateFields.section_id = sectionId
              if (student.email) updateFields.email = student.email
              if (student.middleName) updateFields.middle_name = student.middleName
              updateFields.student_id = userId

              if (Object.keys(updateFields).length > 0) {
                await supabase
                  .from('student_face_registrations')
                  .update(updateFields)
                  .eq('id', existingReg.id)
              }
              results.studentsExisting++
            } else {
              const { error: regError } = await supabase
                .from('student_face_registrations')
                .insert({
                  student_number: student.studentNumber,
                  student_id: userId,
                  first_name: student.firstName,
                  last_name: student.lastName,
                  middle_name: student.middleName || null,
                  email: student.email || null,
                  face_data: 'pending',
                  face_descriptor: null,
                  section_id: sectionId,
                  is_active: true,
                })

              if (regError) {
                results.errors.push(`Student ${student.studentNumber}: ${regError.message}`)
              } else {
                results.studentsCreated++
              }
            }
          } catch (studentErr: any) {
            results.errors.push(`Student ${student.studentNumber}: ${studentErr.message}`)
          }
        }
      } catch (sectionErr: any) {
        results.errors.push(`Section ${sectionPayload.sectionCode}: ${sectionErr.message}`)
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error: any) {
    console.error('Admin upload class list error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
