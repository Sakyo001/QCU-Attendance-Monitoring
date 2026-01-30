import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

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

    // Query with service role - fetch both password and password_hash
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('id, email, password, password_hash, role, is_active, first_name, last_name, student_id, employee_id')
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
    console.log('Password hash in DB:', dbUser.password_hash ? 'exists' : 'NULL/empty')
    console.log('Password provided:', password)

    // Check password with bcrypt (for hashed passwords) or plain text (fallback for old accounts)
    let isPasswordValid = false
    
    if (dbUser.password_hash) {
      // New hashed password - verify with bcrypt
      try {
        isPasswordValid = await bcrypt.compare(password, dbUser.password_hash)
        console.log('Bcrypt password match:', isPasswordValid)
      } catch (bcryptError) {
        console.error('Bcrypt error:', bcryptError)
        isPasswordValid = false
      }
    } else if (dbUser.password) {
      // Fallback to plain text comparison for old accounts without hashes
      isPasswordValid = password === dbUser.password
      console.log('Plain text password match:', isPasswordValid)
      
      // If valid with plain text, automatically hash and update for future logins
      if (isPasswordValid) {
        try {
          const hashedPassword = await bcrypt.hash(password, 10)
          await supabase
            .from('users')
            .update({ password_hash: hashedPassword })
            .eq('id', dbUser.id)
          console.log('Password automatically hashed and updated for user:', email)
        } catch (hashError) {
          console.error('Error hashing password on login:', hashError)
          // Still allow login even if hashing fails
        }
      }
    }
    
    if (!isPasswordValid) {
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
    (supabase as any)
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
