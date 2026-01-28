import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function GET(request: NextRequest) {
  try {
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
