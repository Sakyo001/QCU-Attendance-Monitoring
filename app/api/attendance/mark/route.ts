import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId, sectionId, studentId, faceMatchConfidence } = body

    console.log('📝 Mark attendance request:', { sessionId, sectionId, studentId, faceMatchConfidence })

    if (!sessionId || !studentId) {
      return NextResponse.json({ 
        error: 'Session ID and student ID are required' 
      }, { status: 400 })
    }

    // Get student details to find student_number
    const { data: student, error: studentError } = await supabase
      .from('student_face_registrations')
      .select('id, student_number')
      .eq('id', studentId)
      .single()

    if (studentError || !student) {
      console.error('❌ Student not found:', studentError)
      return NextResponse.json({ 
        error: 'Student not found' 
      }, { status: 404 })
    }

    // Fetch section code if sectionId is provided
    let sectionCode = null
    if (sectionId) {
      try {
        const { data: sectionData, error: sectionError } = await supabase
          .from('sections')
          .select('section_code')
          .eq('id', sectionId)
          .single()

        if (sectionError) {
          console.warn('⚠️ Could not fetch section code:', sectionError)
        } else if (sectionData) {
          sectionCode = sectionData.section_code
          console.log('✅ Found section code:', sectionCode)
        }
      } catch (sectionFetchError) {
        console.warn('⚠️ Error fetching section:', sectionFetchError)
      }
    }

    // Check if attendance record already exists for this student in this session
    const { data: existing } = await supabase
      .from('attendance_records')
      .select('id, checked_in_at')
      .eq('attendance_session_id', sessionId)
      .eq('student_number', student.student_number)
      .single()

    if (existing) {
      console.log('⏸️ Student already marked attendance at:', existing.checked_in_at)
      return NextResponse.json({
        success: true,
        message: 'Student already marked for this session'
      })
    }

    // Create new attendance record
    const { data: insertedRecord, error: insertError } = await supabase
      .from('attendance_records')
      .insert([
        {
          attendance_session_id: sessionId,
          student_registration_id: studentId,
          student_number: student.student_number,
          section_id: sectionCode || null,
          checked_in_at: new Date().toISOString(),
          status: 'present',
          face_match_confidence: faceMatchConfidence || null
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
      studentNumber: student.student_number,
      sessionId,
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
