import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    // Use service role to check registration
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check if student has face registration
    const { data, error } = await supabase
      .from('student_face_registrations')
      .select('id')
      .eq('student_id', studentId)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking face registration:', error)
      return NextResponse.json(
        { error: 'Failed to check registration' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      isRegistered: !!data
    })
  } catch (error: any) {
    console.error('Check registration error:', error)
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    )
  }
}
