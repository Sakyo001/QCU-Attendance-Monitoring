import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

export async function POST(request: NextRequest) {
  try {
    const { professorId, password } = await request.json()

    if (!professorId || !password) {
      return NextResponse.json(
        { error: 'Professor ID and password are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    // Get professor's email and password hash
    const { data: professor, error: professorError } = await supabase
      .from('users')
      .select('id, email, password_hash, password, first_name, last_name')
      .eq('id', professorId)
      .eq('role', 'professor')
      .single()

    if (professorError || !professor) {
      console.error('Professor fetch error:', professorError)
      return NextResponse.json(
        { error: 'Professor not found' },
        { status: 404 }
      )
    }

    // Verify password using bcrypt
    try {
      // Check if password_hash exists (bcrypt hashed), otherwise use plain text password for now
      let isPasswordValid = false
      
      if (professor.password_hash) {
        // Compare with bcrypt hash
        isPasswordValid = await bcrypt.compare(password, professor.password_hash)
      } else if (professor.password) {
        // Fallback to plain text comparison (for existing users without hashed passwords)
        // In production, migrate these passwords to hashes
        isPasswordValid = password === professor.password
        
        // If valid with plain text, hash and update the database
        if (isPasswordValid) {
          const hashedPassword = await bcrypt.hash(password, 10)
          await supabase
            .from('users')
            .update({ password_hash: hashedPassword })
            .eq('id', professorId)
        }
      }
      
      if (!isPasswordValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid password' },
          { status: 401 }
        )
      }
    } catch (bcryptError) {
      console.error('Bcrypt error:', bcryptError)
      return NextResponse.json(
        { success: false, error: 'Password verification failed' },
        { status: 500 }
      )
    }

    // Password is correct
    return NextResponse.json({
      success: true,
      message: 'Password verified successfully',
      professor: {
        id: professor.id,
        firstName: professor.firstName,
        lastName: professor.lastName,
        email: professor.email
      }
    })

  } catch (error) {
    console.error('Password verification error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
