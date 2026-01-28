import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { facultyId, firstName, lastName, email, employeeId, isActive } = body

    if (!facultyId) {
      return NextResponse.json(
        { error: 'Faculty ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    console.log('🔄 Updating faculty member:', facultyId)
    console.log('Update data:', { firstName, lastName, email, employeeId, isActive })

    // Update the users table
    const { data, error } = await supabase
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName,
        email: email,
        employee_id: employeeId,
        is_active: isActive
      })
      .eq('id', facultyId)
      .select()

    if (error) {
      console.error('❌ Error updating faculty:', error)
      throw error
    }

    console.log('✅ Faculty updated successfully:', data)

    return NextResponse.json({
      success: true,
      message: 'Faculty member updated successfully',
      data: data
    })
  } catch (error: any) {
    console.error('❌ Error in faculty update:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update faculty member' },
      { status: 500 }
    )
  }
}
