import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    console.log('API signInWithId: Fetching user with ID:', userId)

    // Use service role client to bypass RLS
    const supabase = createServiceRoleClient()

    const { data: dbUser, error } = await supabase
      .from('users')
      .select('id, email, role, is_active, first_name, last_name, student_id, employee_id')
      .eq('id', userId)
      .maybeSingle()

    console.log('API signInWithId: Query result:', { 
      found: !!dbUser, 
      dbUser: dbUser ? { 
        id: dbUser.id, 
        name: `${dbUser.first_name} ${dbUser.last_name}`, 
        role: dbUser.role, 
        is_active: dbUser.is_active 
      } : null,
      error 
    })

    if (error) {
      console.error('API signInWithId: Database error', error)
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      )
    }

    if (!dbUser) {
      console.error('API signInWithId: User not found for ID:', userId)
      return NextResponse.json(
        { error: `User not found for ID: ${userId}` },
        { status: 404 }
      )
    }

    if (!dbUser.is_active) {
      console.warn('API signInWithId: User is inactive')
      return NextResponse.json(
        { error: 'Account is inactive' },
        { status: 403 }
      )
    }

    // Return user data
    return NextResponse.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        role: dbUser.role,
        firstName: dbUser.first_name,
        lastName: dbUser.last_name,
        studentId: dbUser.student_id,
        employeeId: dbUser.employee_id,
        isActive: dbUser.is_active
      }
    })

  } catch (error) {
    console.error('API signInWithId: Unexpected error', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
