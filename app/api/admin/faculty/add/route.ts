import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { firstName, lastName, email, password, employeeId, role, contactNumber } = body

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !employeeId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Use service role client (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1. Create user account
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email: email,
        password_hash: hashedPassword,
        employee_id: employeeId,
        role: role || 'professor',
        is_active: true,
      })
      .select()
      .single()

    if (userError) {
      console.error('User creation error:', userError)
      return NextResponse.json(
        { error: userError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      userId: userData.id,
      message: 'Faculty member created successfully',
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
