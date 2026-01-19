import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    // Create a Supabase client with service role key (bypasses RLS)
    const supabase = createServiceRoleClient()

    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('role', 'professor')
      .order('last_name')

    if (error) {
      console.error('Error fetching professors:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    console.log('Professors fetched:', data?.length)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Exception fetching professors:', error)
    return NextResponse.json(
      { error: 'Failed to fetch professors' },
      { status: 500 }
    )
  }
}
