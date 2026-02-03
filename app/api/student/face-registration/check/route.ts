import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const studentId = searchParams.get('studentId')

    if (!studentId) {
      return NextResponse.json(
        { error: 'Student ID is required' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    // First, try to find the student_number for this UUID from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('student_id')
      .eq('id', studentId)
      .single()

    if (userError) {
      console.error('Error looking up user:', userError)
      return NextResponse.json({
        success: true,
        isRegistered: false
      })
    }

    if (!userData?.student_id) {
      console.log('No student_number found for user:', studentId)
      return NextResponse.json({
        success: true,
        isRegistered: false
      })
    }

    // Now check if there's a face registration for this student_number
    const { data, error } = await supabase
      .from('student_face_registrations')
      .select('id')
      .eq('student_number', userData.student_id)
      .limit(1)

    if (error) {
      console.error('Error checking face registration:', error)
      return NextResponse.json({
        success: true,
        isRegistered: false
      })
    }

    // data will be an array, check if it has any records
    const isRegistered = data && data.length > 0

    return NextResponse.json({
      success: true,
      isRegistered: isRegistered
    })
  } catch (error: any) {
    console.error('Check registration error:', error)
    return NextResponse.json({
      success: true,
      isRegistered: false
    })
  }
}

