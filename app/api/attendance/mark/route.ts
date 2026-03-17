import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { getOfflineStudentsBySection } from '@/app/api/_utils/offline-kiosk-cache'

/**
 * Determine attendance status based on class start time.
 * - Within 20 minutes of start (grace period) → 'present'
 * - 20-30 minutes → 'late'
 * - After 30 minutes → locked (no more marking allowed)
 * 
 * Example: If class starts at 8:00 AM:
 * - 8:00-8:20 AM → Present
 * - 8:21-8:30 AM → Late
 * - 8:30+ AM → Locked
 */
function getAttendanceStatus(startTime: string | null, dayOfWeek: string | null): { status: 'present' | 'late'; locked: boolean } {
  if (!startTime || !dayOfWeek) {
    console.warn('⚠️ Schedule missing startTime or dayOfWeek:', { startTime, dayOfWeek })
    return { status: 'present', locked: false }
  }

  const now = new Date()
  const today = now.toLocaleDateString('en-US', { weekday: 'long' })

  // If not the right day, default to present
  if (today !== dayOfWeek) {
    console.log(`⏳ Not today (${today} !== ${dayOfWeek}), marking as present`)
    return { status: 'present', locked: false }
  }

  // Parse start_time (e.g., "08:00:00" or "08:00")
  const timeParts = startTime.split(':')
  const hours = parseInt(timeParts[0], 10)
  const minutes = parseInt(timeParts[1], 10)
  
  const classStart = new Date(now)
  classStart.setHours(hours, minutes, 0, 0)

  const diffMs = now.getTime() - classStart.getTime()
  const diffMinutes = diffMs / (1000 * 60)

  console.log(`⏱️ Schedule time: ${startTime}, Current time: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}, Diff: ${diffMinutes.toFixed(1)} min`)

  const GRACE_PERIOD = 20
  const LOCK_THRESHOLD = 30

  if (diffMinutes < 0) {
    console.log('✅ Before class — marking as present')
    return { status: 'present', locked: false }
  } else if (diffMinutes <= GRACE_PERIOD) {
    console.log('✅ Within grace period — marking as present')
    return { status: 'present', locked: false }
  } else if (diffMinutes <= LOCK_THRESHOLD) {
    console.log('⚠️ Late — marking as late')
    return { status: 'late', locked: false }
  } else {
    console.log('🔒 Locked — no more marking allowed')
    return { status: 'late', locked: true }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const {
      sectionId,
      studentId,
      studentNumber,
      faceMatchConfidence,
      scheduleId,
      scheduleStartTime,
      scheduleDayOfWeek,
    } = body

    console.log('📝 Mark attendance request:', {
      sectionId,
      studentId,
      studentNumber,
      faceMatchConfidence,
      scheduleId,
      scheduleStartTime,
      scheduleDayOfWeek,
    })

    if (!sectionId || !studentId) {
      return NextResponse.json({ 
        error: 'Section ID and student ID are required' 
      }, { status: 400 })
    }

    // Get class session info for time-based rules
    let classSession: any = null
    if (scheduleId) {
      const { data } = await supabase
        .from('class_sessions')
        .select('start_time, end_time, day_of_week')
        .eq('id', scheduleId)
        .single()
      classSession = data
    } else {
      // Try to find a session for this section today
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })
      const { data } = await supabase
        .from('class_sessions')
        .select('start_time, end_time, day_of_week')
        .eq('section_id', sectionId)
        .eq('day_of_week', today)
        .limit(1)
        .single()
      classSession = data
    }

    // Determine status based on class time.
    // In offline mode Supabase may be unreachable, so fall back to schedule info
    // sent from the kiosk-selected session.
    const effectiveStartTime = classSession?.start_time || scheduleStartTime || null
    const effectiveDayOfWeek = classSession?.day_of_week || scheduleDayOfWeek || null
    console.log('⏱️ Attendance status source:', {
      source: classSession ? 'class_sessions' : 'request-fallback',
      effectiveStartTime,
      effectiveDayOfWeek,
    })
    const { status: attendanceStatus, locked } = getAttendanceStatus(
      effectiveStartTime,
      effectiveDayOfWeek
    )

    // If locked, reject the attendance marking
    if (locked) {
      console.log('🔒 Attendance locked — 30+ minutes past class start')
      return NextResponse.json({
        success: false,
        locked: true,
        message: 'Attendance recording is locked (30+ minutes past class start time)'
      })
    }

    // Get today's date
    const todayDate = new Date().toISOString().split('T')[0]

    // Generate a deterministic session ID based on section + date
    const sessionKey = `attendance-${sectionId}-${todayDate}`
    const sessionId = uuidv5(sessionKey, NAMESPACE_NIL)
    
    console.log('📅 Generated session ID for:', sessionKey, '→', sessionId)

    // First, get the student registration by ID (coming from face match)
    let registration: any = null
    let usingOfflineCache = false

    try {
      const { data, error: registrationError } = await supabase
        .from('student_face_registrations')
        .select('id, first_name, last_name, student_number, section_id, is_active')
        .eq('id', studentId)
        .single()

      if (registrationError || !data) {
        // Fallback: student may have been deleted/re-registered; resolve by stable student_number.
        if (studentNumber) {
          const { data: byNumber, error: byNumberError } = await supabase
            .from('student_face_registrations')
            .select('id, first_name, last_name, student_number, section_id, is_active')
            .eq('student_number', studentNumber)
            .eq('section_id', sectionId)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle()

          if (!byNumberError && byNumber) {
            registration = byNumber
            console.log('✅ Resolved registration by student_number fallback:', byNumber.student_number)
          } else {
            throw registrationError || byNumberError || new Error('Student registration not found')
          }
        } else {
          throw registrationError || new Error('Student registration not found')
        }
      } else {
        registration = data
      }

      console.log('✅ Found registration from Supabase:', registration.first_name, registration.last_name)
    } catch (dbError) {
      // Fallback to offline cache
      console.warn('⚠️ Supabase unavailable, checking offline student cache:', dbError)
      usingOfflineCache = true

      try {
        const offlineStudents = await getOfflineStudentsBySection(sectionId)
        const normalizedStudentNumber = String(studentNumber || '').trim().toLowerCase()
        const offlineStudent = offlineStudents.find((s) => {
          if (s.id === studentId) return true
          if (!normalizedStudentNumber) return false
          return String(s.studentNumber || '').trim().toLowerCase() === normalizedStudentNumber
        })

        if (!offlineStudent) {
          return NextResponse.json({
            success: false,
            error: 'Student not found in offline cache',
            usingOfflineCache: true
          }, { status: 404 })
        }

        registration = {
          id: offlineStudent.id,
          first_name: offlineStudent.firstName,
          last_name: offlineStudent.lastName,
          student_number: offlineStudent.studentNumber,
          section_id: offlineStudent.sectionId,
          is_active: offlineStudent.isActive
        }

        console.log('📦 Found registration from offline cache:', registration.first_name, registration.last_name)
      } catch (cacheError) {
        console.error('❌ Error accessing offline cache:', cacheError)
        return NextResponse.json({
          success: false,
          error: 'Unable to verify student identity',
          usingOfflineCache: true
        }, { status: 500 })
      }
    }

    if (!registration) {
      console.error('❌ Student registration not found')
      return NextResponse.json({
        success: false,
        error: 'Student registration not found',
        usingOfflineCache
      }, { status: 404 })
    }

    // Prevent marking attendance for students from other sections due to
    // false face matches or stale encodings.
    if ((registration as any).is_active === false) {
      return NextResponse.json({
        success: false,
        error: 'Student registration is inactive'
      }, { status: 400 })
    }

    if ((registration as any).section_id && (registration as any).section_id !== sectionId) {
      return NextResponse.json({
        success: false,
        error: 'Student is not enrolled in this section'
      }, { status: 400 })
    }

    // If scheduleId provided, ensure it belongs to the same section.
    if (scheduleId) {
      const { data: schedRow, error: schedErr } = await supabase
        .from('class_sessions')
        .select('id, section_id')
        .eq('id', scheduleId)
        .single()
      if (schedErr) {
        console.error('❌ Failed to validate scheduleId:', schedErr)
      } else if (schedRow?.section_id && schedRow.section_id !== sectionId) {
        return NextResponse.json({
          success: false,
          error: 'Schedule does not belong to this section'
        }, { status: 400 })
      }
    }

    console.log('✅ Found registration:', registration.first_name, registration.last_name)

    // In offline mode, skip duplicate check and just accept the mark
    if (!usingOfflineCache) {
      // Check if attendance record already exists for today
      let existing: any = null
      try {
        const { data } = await supabase
          .from('attendance_records')
          .select('id, checked_in_at, status')
          .eq('attendance_session_id', sessionId)
          .eq('student_number', registration.student_number)
          .single()
        existing = data
      } catch {
        existing = null
      }

      if (existing) {
        console.log('⏸️ Student already marked attendance at:', existing.checked_in_at)
        return NextResponse.json({
          success: true,
          alreadyMarked: true,
          message: 'Student already marked for today',
          record: {
            status: existing.status || attendanceStatus,
            checked_in_at: existing.checked_in_at || null,
          },
          usingOfflineCache: false
        })
      }
    }

    // Try to create attendance record online; in offline mode, just accept it
    let insertedRecord: any = null

    if (!usingOfflineCache) {
      try {
        const { data, error: insertError } = await supabase
          .from('attendance_records')
          .insert([
            {
              attendance_session_id: sessionId,
              student_registration_id: registration.id,
              student_number: registration.student_number,
              checked_in_at: new Date().toISOString(),
              face_match_confidence: faceMatchConfidence || null,
              status: attendanceStatus,
              section_id: sectionId
            }
          ])
          .select()

        if (insertError) {
          console.error('❌ Insert error:', insertError)
          throw insertError
        }

        insertedRecord = data?.[0]
        console.log(`✅ Attendance marked as '${attendanceStatus}' for:`, {
          studentName: `${registration.first_name} ${registration.last_name}`,
          studentNumber: registration.student_number,
          sectionId,
          sessionId,
          status: attendanceStatus,
          recordId: insertedRecord?.id,
          timestamp: new Date().toISOString()
        })
      } catch (insertError: any) {
        console.error('❌ Failed to insert attendance:', insertError)
        return NextResponse.json({
          success: false,
          error: 'Failed to mark attendance',
          details: insertError.message,
          usingOfflineCache: false
        }, { status: 400 })
      }
    } else {
      // Offline mode: just accept the mark
      console.log(`📱 [OFFLINE] Attendance marked as '${attendanceStatus}' for:`, {
        studentName: `${registration.first_name} ${registration.last_name}`,
        studentNumber: registration.student_number,
        sectionId,
        status: attendanceStatus,
        timestamp: new Date().toISOString()
      })
    }

    return NextResponse.json({
      success: true,
      message: `Attendance marked as ${attendanceStatus}`,
      record: insertedRecord ? insertedRecord : { 
        student_number: registration.student_number,
        status: attendanceStatus,
        checked_in_at: new Date().toISOString()
      },
      usingOfflineCache
    })
  } catch (error) {
    console.error('❌ Attendance error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
