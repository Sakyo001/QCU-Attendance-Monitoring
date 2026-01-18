import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = body

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)
    const now = new Date().toISOString()

    // Update session to inactive
    const { data, error } = await supabase
      .from('attendance_sessions')
      .update({
        is_active: false,
        shift_closed_at: now
      })
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      console.error('Error closing session:', error)
      return NextResponse.json(
        { error: 'Failed to close shift' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Shift closed successfully',
      session: data
    })

  } catch (error: any) {
    console.error('Exception in close shift:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
