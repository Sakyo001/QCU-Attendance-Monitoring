import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { studentId } = body

    if (!studentId) {
      return NextResponse.json(
        { error: 'Student ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    console.log('🗑️ Deleting student:', studentId)

    // First, delete from student_face_registrations
    const { error: deleteFaceError } = await supabase
      .from('student_face_registrations')
      .delete()
      .eq('student_id', studentId)

    if (deleteFaceError) {
      console.warn('⚠️ Warning deleting face registration:', deleteFaceError)
      // Don't throw - might not exist
    } else {
      console.log('✅ Deleted from student_face_registrations')
    }

    // Delete from users table
    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .eq('id', studentId)

    if (deleteUserError) {
      console.error('❌ Error deleting from users table:', deleteUserError)
      throw deleteUserError
    }

    console.log('✅ Deleted from users table')

    // Delete the auth user
    try {
      const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(studentId)
      
      if (deleteAuthError) {
        console.warn('⚠️ Warning deleting auth user:', deleteAuthError)
      } else {
        console.log('✅ Deleted from auth table')
      }
    } catch (authError) {
      console.warn('⚠️ Auth deletion failed (non-critical):', authError)
    }

    return NextResponse.json({
      success: true,
      message: 'Student deleted successfully'
    })
  } catch (error: any) {
    console.error('❌ Error in student deletion:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete student' },
      { status: 500 }
    )
  }
}
