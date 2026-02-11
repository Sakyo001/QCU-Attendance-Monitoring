import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { firstName, lastName, email, employeeId, role, contactNumber, faceData, faceDescriptor } = body

    // Validate required fields
    if (!firstName || !lastName || !employeeId) {
      return NextResponse.json(
        { error: 'Missing required fields (firstName, lastName, employeeId)' },
        { status: 400 }
      )
    }

    // Face data is required for facial recognition login
    if (!faceData || !faceDescriptor) {
      return NextResponse.json(
        { error: 'Face data is required for faculty registration' },
        { status: 400 }
      )
    }

    // Use service role client (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1. Create user account (no password needed - face login only)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email: email || null,
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

    console.log('Created user successfully:', {
      id: userData.id,
      name: `${userData.first_name} ${userData.last_name}`,
      role: userData.role,
      is_active: userData.is_active
    })

    // Verify user was created and can be queried back
    const { data: verifyUser, error: verifyError } = await supabase
      .from('users')
      .select('id, first_name, last_name, role, is_active')
      .eq('id', userData.id)
      .maybeSingle()
    
    console.log('Verify user query result:', { 
      found: !!verifyUser, 
      verifyUser,
      verifyError 
    })

    if (!verifyUser) {
      console.error('WARNING: User was created but cannot be queried back!')
    }

    // 2. Create face registration record
    console.log('Creating face registration for professor_id:', userData.id)
    const { error: faceError } = await supabase
      .from('professor_face_registrations')
      .insert({
        professor_id: userData.id,
        first_name: firstName,
        last_name: lastName,
        face_data: faceData,
        face_descriptor: faceDescriptor,
        is_active: true
      })

    if (faceError) {
      console.error('Face registration error:', faceError)
      // Rollback user creation
      await supabase.from('users').delete().eq('id', userData.id)
      return NextResponse.json(
        { error: 'Failed to save face data: ' + faceError.message },
        { status: 400 }
      )
    }

    console.log('Face registration created successfully for:', userData.id)

    return NextResponse.json({
      success: true,
      userId: userData.id,
      message: 'Faculty member created successfully with facial recognition',
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
