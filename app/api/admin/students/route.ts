import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()

    // Fetch all students from users table
    const { data, error } = await supabase
      .from('users')
      .select('id,first_name,last_name,email,student_id,is_active')
      .eq('role', 'student')
      .order('last_name', { ascending: true })

    if (error) {
      console.error('Students fetch error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json(data || [])
  } catch (error: any) {
    console.error('Exception in students fetch:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch students' },
      { status: 500 }
    )
  }
}
