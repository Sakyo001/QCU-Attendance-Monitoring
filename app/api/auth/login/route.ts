import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, password } = body

    console.log('Login attempt for:', email)

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Use service role for full access (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Query with service role
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('id, email, password, role, is_active, first_name, last_name, student_id, employee_id')
      .eq('email', email)
      .single()

    if (dbError) {
      console.error('Database error:', dbError)
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    if (!dbUser) {
      console.error('No user found for email:', email)
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    console.log('User found:', dbUser.email, 'Role:', dbUser.role)
    console.log('Password in DB:', dbUser.password ? 'exists' : 'NULL/empty')
    console.log('Password provided:', password)
    console.log('Passwords match:', dbUser.password === password)

    // Check password
    if (dbUser.password !== password) {
      console.error('Password mismatch for user:', email)
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Check if user is active
    if (!dbUser.is_active) {
      return NextResponse.json(
        { error: 'Account is inactive. Please contact administrator.' },
        { status: 403 }
      )
    }

    // Update last_login (fire and forget)
    supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', dbUser.id)
      .then()
      .catch(() => {})

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = dbUser
    return NextResponse.json(userWithoutPassword)
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
