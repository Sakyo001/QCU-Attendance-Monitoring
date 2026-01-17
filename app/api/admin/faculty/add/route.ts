import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { firstName, lastName, email, password, employeeId, role, contactNumber, selectedSections } = body

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !employeeId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get service role client (bypasses RLS)
    const supabase = await createClient()

    // 1. Create user account
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email: email,
        password: password,
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

    // 2. Assign sections if provided
    if (selectedSections && selectedSections.length > 0) {
      const assignments = selectedSections.map((sectionId: string) => ({
        section_id: sectionId,
        professor_id: userData.id,
      }))

      const { error: assignError } = await supabase
        .from('section_professors')
        .insert(assignments)

      if (assignError) {
        console.error('Section assignment error:', assignError)
        // Log but don't fail - user was created successfully
        console.warn('Failed to assign sections, but user was created')
      }
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
