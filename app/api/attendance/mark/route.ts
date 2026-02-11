import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

/**
 * Determine attendance status based on class start time.
 * - Within 20 minutes of start (grace period) → 'present'
 * - After 20 minutes → 'late'
 * - After 60 minutes → locked (no more marking allowed)
 * 
 * Example: If class starts at 6:00 AM:
 * - 6:00-6:20 AM → Present
 * - 6:21-7:00 AM → Late
 * - 7:01+ AM → Locked
 */
function getAttendanceStatus(startTime: string | null, dayOfWeek: string | null): { status: 'present' | 'late'; locked: boolean } {
  if (!startTime || !dayOfWeek) {
    return { status: 'present', locked: false }
  }

  const now = new Date()
  const today = now.toLocaleDateString('en-US', { weekday: 'long' })

  // If not the right day, default to present
  if (today !== dayOfWeek) {
    return { status: 'present', locked: false }
  }

  // Parse start_time (e.g., "08:00:00" or "08:00")
  const [hours, minutes] = startTime.split(':').map(Number)
  const classStart = new Date(now)
  classStart.setHours(hours, minutes, 0, 0)

  const diffMs = now.getTime() - classStart.getTime()
  const diffMinutes = diffMs / (1000 * 60)

  // Grace Period: 20 minutes after class start (students marked as 'present')
  // For example: if class starts at 6:00 AM, students arriving from 6:00-6:20 are 'present'
  const GRACE_PERIOD = 20
  // Late threshold: After 20 minutes, students marked as 'late'
  // For example: if class starts at 6:00 AM, students arriving at 6:21+ are 'late'
  const LATE_THRESHOLD = 20
  // Lock threshold: Keep attendance open for late marking (can adjust separately if needed)
  const LOCK_THRESHOLD = 60 // Allow late marking for up to 60 minutes

  if (diffMinutes < 0) {
    // Before class starts — mark as present (early arrival)
    return { status: 'present', locked: false }
  } else if (diffMinutes <= GRACE_PERIOD) {
    // Within 20-minute grace period — mark as present
    return { status: 'present', locked: false }
  } else if (diffMinutes <= LOCK_THRESHOLD) {
    // After 20 minutes but within lock window — mark as late
    return { status: 'late', locked: false }
  } else {
    // After lock threshold — mark as late, attendance locked
    return { status: 'late', locked: true }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { sectionId, studentId, faceMatchConfidence, scheduleId } = body

    console.log('📝 Mark attendance request:', { sectionId, studentId, faceMatchConfidence, scheduleId })

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

    // Determine status based on class time
    const { status: attendanceStatus, locked } = getAttendanceStatus(
      classSession?.start_time || null,
      classSession?.day_of_week || null
    )

    // If locked, reject the attendance marking
    if (locked) {
      console.log('🔒 Attendance locked — 60+ minutes past class start')
      return NextResponse.json({
        success: false,
        locked: true,
        message: 'Attendance recording is locked (60+ minutes past class start time)'
      })
    }

    // Get today's date
    const todayDate = new Date().toISOString().split('T')[0]

    // Generate a deterministic session ID based on section + date
    const sessionKey = `attendance-${sectionId}-${todayDate}`
    const sessionId = uuidv5(sessionKey, NAMESPACE_NIL)
    
    console.log('📅 Generated session ID for:', sessionKey, '→', sessionId)

    // First, get the student registration by ID (coming from face match)
    const { data: registration, error: registrationError } = await supabase
      .from('student_face_registrations')
      .select('id, first_name, last_name, student_number')
      .eq('id', studentId)
      .single()

    if (registrationError || !registration) {
      console.error('❌ Student registration not found:', registrationError)
      return NextResponse.json({ 
        error: 'Student registration not found' 
      }, { status: 404 })
    }

    console.log('✅ Found registration:', (registration as any).first_name, (registration as any).last_name)

    // Check if attendance record already exists for today
    const { data: existing } = await supabase
      .from('attendance_records')
      .select('id, checked_in_at')
      .eq('attendance_session_id', sessionId)
      .eq('student_number', (registration as any).student_number)
      .single()

    if (existing) {
      console.log('⏸️ Student already marked attendance at:', existing.checked_in_at)
      return NextResponse.json({
        success: true,
        alreadyMarked: true,
        message: 'Student already marked for today'
      })
    }

    // Create new attendance record with time-based status
    const { data: insertedRecord, error: insertError } = await supabase
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
      console.error('Error details:', {
        code: insertError.code,
        message: insertError.message,
        details: insertError.details
      })
      return NextResponse.json({ 
        error: 'Failed to mark attendance',
        details: insertError.message
      }, { status: 400 })
    }

    console.log(`✅ Attendance marked as '${attendanceStatus}' for:`, {
      studentName: `${registration.first_name} ${registration.last_name}`,
      studentNumber: registration.student_number,
      sectionId,
      sessionId,
      status: attendanceStatus,
      recordId: insertedRecord?.[0]?.id,
      timestamp: new Date().toISOString()
    })

    return NextResponse.json({
      success: true,
      message: `Attendance marked as ${attendanceStatus}`,
      record: insertedRecord?.[0]
    })
  } catch (error) {
    console.error('❌ Attendance error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
