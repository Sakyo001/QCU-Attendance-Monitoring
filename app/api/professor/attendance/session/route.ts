import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const classSessionId = searchParams.get('classSessionId')
    const checkActive = searchParams.get('check')

    // If check=true, return whether there's any active session
    if (checkActive === 'true') {
      const { createClient: createServiceClient } = await import('@supabase/supabase-js')
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

      if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json(
          { success: false, error: 'Supabase configuration missing' },
          { status: 500 }
        )
      }

      const supabase = createServiceClient(supabaseUrl, supabaseServiceKey)

      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single()

      return NextResponse.json({
        success: true,
        isActive: !!data,
        session: data || null
      })
    }

    if (!classSessionId) {
      return NextResponse.json(
        { error: 'Class session ID is required' },
        { status: 400 }
      )
    }

    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)

    // Get today's session for this class
    const today = new Date().toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('class_session_id', classSessionId)
      .eq('session_date', today)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching attendance session:', error)
      return NextResponse.json(
        { error: 'Failed to fetch session' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      session: data || null
    })

  } catch (error: any) {
    console.error('Exception in attendance session fetch:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
