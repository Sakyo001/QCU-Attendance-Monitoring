import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { studentId, firstName, lastName, email, studentNumber, isActive } = body

    if (!studentId) {
      return NextResponse.json(
        { error: 'Student ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    console.log('🔄 Updating student:', studentId)

    // Update the users table
    const { data, error } = await supabase
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName,
        email: email,
        student_id: studentNumber,
        is_active: isActive
      })
      .eq('id', studentId)
      .select()

    if (error) {
      console.error('❌ Error updating student in users table:', error)
      throw error
    }

    console.log('✅ Student updated in users table')

    // Also update the auth user if email changed
    try {
      const { error: authError } = await supabase.auth.admin.updateUserById(
        studentId,
        { email: email }
      )

      if (authError) {
        console.warn('⚠️ Warning updating auth email:', authError)
        // Don't throw - user might not exist in auth
      } else {
        console.log('✅ Auth user email updated')
      }
    } catch (authUpdateError) {
      console.warn('⚠️ Auth email update failed (non-critical):', authUpdateError)
    }

    return NextResponse.json({
      success: true,
      message: 'Student updated successfully',
      data: data
    })
  } catch (error: any) {
    console.error('❌ Error in student update:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update student' },
      { status: 500 }
    )
  }
}
