import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const searchParams = request.nextUrl.searchParams
    const studentId = searchParams.get('studentId')

    if (!studentId) {
      return NextResponse.json({ error: 'Student ID parameter required' }, { status: 400 })
    }

    // Check if student ID exists in users table
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('student_id', studentId)
      .limit(1)

    if (error) {
      console.error('Database query error:', error)
      return NextResponse.json({ error: 'Failed to check student ID' }, { status: 500 })
    }

    // Return whether student ID exists
    return NextResponse.json({ exists: data && data.length > 0 })
  } catch (error) {
    console.error('Check student ID error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
