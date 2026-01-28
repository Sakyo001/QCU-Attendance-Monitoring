import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { facultyId } = body

    if (!facultyId) {
      return NextResponse.json(
        { error: 'Faculty ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    console.log('🗑️ Deleting faculty member:', facultyId)

    // First, delete from users table
    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .eq('id', facultyId)

    if (deleteUserError) {
      console.error('❌ Error deleting from users table:', deleteUserError)
      throw deleteUserError
    }

    console.log('✅ Deleted from users table')

    // Then, delete the auth user
    try {
      const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(facultyId)
      
      if (deleteAuthError) {
        console.warn('⚠️ Warning deleting auth user (might not exist):', deleteAuthError)
        // Don't throw - user might not exist in auth table
      } else {
        console.log('✅ Deleted from auth table')
      }
    } catch (authError) {
      console.warn('⚠️ Auth deletion failed (non-critical):', authError)
    }

    return NextResponse.json({
      success: true,
      message: 'Faculty member deleted successfully'
    })
  } catch (error: any) {
    console.error('❌ Error in faculty deletion:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete faculty member' },
      { status: 500 }
    )
  }
}
