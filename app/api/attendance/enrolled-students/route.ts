import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { getOfflineStudentsBySection, upsertOfflineStudents } from '@/app/api/_utils/offline-kiosk-cache'

/**
 * Get all enrolled students in a section with their attendance status for today.
 * Used by the kiosk to display the real-time student list.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sectionId = searchParams.get('sectionId')
    const scheduleId = searchParams.get('scheduleId')

    if (!sectionId) {
      return NextResponse.json({ error: 'sectionId required' }, { status: 400 })
    }

    let studentList: any[] = []
    let source: 'supabase' | 'offline-cache' = 'supabase'

    try {
      const supabase = getSupabaseAdmin()

      // Get all registered students in this section
      const { data: students, error: studentsError } = await supabase
        .from('student_face_registrations')
        .select('id, student_number, first_name, last_name, section_id, face_descriptor, is_active')
        .eq('section_id', sectionId)
        .eq('is_active', true)
        .order('last_name')

      if (studentsError) {
        throw studentsError
      }

      // Get today's attendance records using schedule-specific session ID
      const todayDate = new Date().toISOString().split('T')[0]
      const sessionKey = scheduleId
        ? `attendance-${scheduleId}-${todayDate}`
        : `attendance-${sectionId}-${todayDate}`
      const sessionId = uuidv5(sessionKey, NAMESPACE_NIL)

      console.log('📚 Enrolled-students using session:', { sessionKey, sessionId, scheduleId })

      const { data: records, error: recordsError } = await supabase
        .from('attendance_records')
        .select('student_number, status, checked_in_at, face_match_confidence')
        .eq('attendance_session_id', sessionId)

      if (recordsError) {
        console.error('Error fetching records:', recordsError)
      }

      // Map records by student number
      const recordMap = new Map<string, any>(
        ((records as any[]) || []).map((r: any) => [String(r.student_number), r])
      )

      // Build student list with status
      studentList = (students || []).map((s: any) => {
        const record = recordMap.get(String(s.student_number))
        
        // Parse face descriptor
        let descriptor = s.face_descriptor
        if (descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)) {
          descriptor = Object.values(descriptor)
        }
        const embedding = Array.isArray(descriptor)
          ? descriptor.map((value: any) => Number(value))
          : undefined

        return {
          id: s.id,
          studentNumber: s.student_number,
          firstName: s.first_name,
          lastName: s.last_name,
          status: record?.status || 'pending',
          checkedInAt: record?.checked_in_at || null,
          confidence: record?.face_match_confidence || null,
          embedding // Include embedding for FaceNet matching!
        }
      })

      // Sync student identity + descriptors for offline name listing.
      await upsertOfflineStudents(
        (students || []).map((s: any) => {
          let descriptor = s.face_descriptor
          if (descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)) {
            descriptor = Object.values(descriptor)
          }

          return {
            id: String(s.id),
            studentNumber: String(s.student_number || ''),
            firstName: String(s.first_name || ''),
            lastName: String(s.last_name || ''),
            sectionId: String(s.section_id || sectionId),
            faceDescriptor: Array.isArray(descriptor)
              ? descriptor.map((value: any) => Number(value))
              : undefined,
            isActive: s.is_active !== false,
          }
        })
      )
    } catch (error) {
      console.warn('⚠️ Failed to fetch roster from Supabase, using offline cache:', error)
      source = 'offline-cache'
      const cachedStudents = await getOfflineStudentsBySection(sectionId)
      studentList = cachedStudents.map((s) => {
        let descriptor = s.faceDescriptor
        const embedding = Array.isArray(descriptor)
          ? descriptor
          : undefined
        
        return {
          id: s.id,
          studentNumber: s.studentNumber,
          firstName: s.firstName,
          lastName: s.lastName,
          status: 'pending',
          checkedInAt: null,
          confidence: null,
          embedding // Include embedding for FaceNet matching!
        }
      })
    }

    const present = studentList.filter((s: any) => s.status === 'present').length
    const late = studentList.filter((s: any) => s.status === 'late').length
    const absent = studentList.filter((s: any) => s.status === 'absent').length
    const pending = studentList.filter((s: any) => s.status === 'pending').length

    return NextResponse.json({
      success: true,
      students: studentList,
      stats: { present, late, absent, pending, total: studentList.length },
      source,
    })
  } catch (error) {
    console.error('Error fetching enrolled students:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
