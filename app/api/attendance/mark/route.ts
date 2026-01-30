import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, NIL as NAMESPACE_NIL } from 'uuid'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { sectionId, studentId, faceMatchConfidence } = body

    console.log('📝 Mark attendance request:', { sectionId, studentId, faceMatchConfidence })

    if (!sectionId || !studentId) {
      return NextResponse.json({ 
        error: 'Section ID and student ID are required' 
      }, { status: 400 })
    }

    // Get today's date
    const todayDate = new Date().toISOString().split('T')[0]

    // Generate a deterministic session ID based on section + date
    // This ensures the same session ID for the same section on the same day
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
        message: 'Student already marked for today'
      })
    }

    // Create new attendance record using actual schema columns
    const { data: insertedRecord, error: insertError } = await supabase
      .from('attendance_records')
      .insert([
        {
          attendance_session_id: sessionId,
          student_registration_id: registration.id,
          student_number: registration.student_number,
          checked_in_at: new Date().toISOString(),
          face_match_confidence: faceMatchConfidence || null,
          status: 'present',
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

    console.log('✅ Attendance marked successfully for:', {
      studentName: `${registration.first_name} ${registration.last_name}`,
      studentNumber: registration.student_number,
      sectionId,
      sessionId,
      recordId: insertedRecord?.[0]?.id,
      timestamp: new Date().toISOString()
    })

    return NextResponse.json({
      success: true,
      message: 'Attendance marked successfully',
      record: insertedRecord?.[0]
    })
  } catch (error) {
    console.error('❌ Attendance error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
