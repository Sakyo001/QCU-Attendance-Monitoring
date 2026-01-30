import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { sessionId } = body

    console.log('📝 Close shift request:', { sessionId })

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

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
      console.error('❌ Error closing session:', error)
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      })
      return NextResponse.json(
        { 
          error: 'Failed to close shift',
          details: error.message
        },
        { status: 500 }
      )
    }

    console.log('✅ Shift closed successfully:', { sessionId, closedAt: now })

    return NextResponse.json({
      success: true,
      message: 'Shift closed successfully',
      session: data
    })

  } catch (error: any) {
    console.error('❌ Exception in close shift:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
