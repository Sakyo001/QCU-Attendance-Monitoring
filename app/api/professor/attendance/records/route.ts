import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID required' },
        { status: 400 },
      )
    }

    // Fetch attendance records with student details
    const { data, error } = await supabase
      .from('attendance_records')
      .select(`
        id,
        session_id,
        user_id,
        status,
        time_in,
        time_out,
        created_at,
        users (
          id,
          first_name,
          last_name,
          student_id,
          profile_picture_url
        )
      `)
      .eq('session_id', sessionId)
      .order('time_in', { ascending: true })

    if (error) {
      console.error('Error fetching attendance records:', error)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      )
    }

    // Transform response to flatten user data
    const records = data.map((record: any) => ({
      id: record.id,
      session_id: record.session_id,
      user_id: record.user_id,
      status: record.status,
      time_in: record.time_in,
      time_out: record.time_out,
      created_at: record.created_at,
      first_name: record.users?.first_name,
      last_name: record.users?.last_name,
      student_id: record.users?.student_id,
      profile_picture_url: record.users?.profile_picture_url,
    }))

    return NextResponse.json({
      success: true,
      records,
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    )
  }
}
