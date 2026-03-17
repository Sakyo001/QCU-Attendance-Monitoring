import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()

    console.log('🗑️ Deleting all students')

    // Get all student UUIDs from users table where role = 'student'
    const { data: students, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'student')

    if (fetchError) {
      console.error('❌ Error fetching students:', fetchError)
      throw fetchError
    }

    const studentIds = (students || []).map((s: any) => s.id)

    if (studentIds.length === 0) {
      return NextResponse.json({
        success: true,
        deletedCount: 0,
        message: 'No students found to delete'
      })
    }

    let deletedCount = 0

    // Delete from student_face_registrations first (foreign key constraint)
    const { error: deleteFaceError } = await supabase
      .from('student_face_registrations')
      .delete()
      .in('student_id', studentIds)

    if (deleteFaceError) {
      console.warn('⚠️ Warning deleting face registrations:', deleteFaceError)
      // Don't throw - might not exist
    } else {
      console.log('✅ Deleted all face registrations')
    }

    // Delete from users table
    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .in('id', studentIds)

    if (deleteUserError) {
      console.error('❌ Error deleting from users table:', deleteUserError)
      throw deleteUserError
    }

    console.log('✅ Deleted all students from users table')
    deletedCount = studentIds.length

    // Delete auth users
    let authDeletedCount = 0
    for (const studentId of studentIds) {
      try {
        const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(studentId)
        
        if (!deleteAuthError) {
          authDeletedCount++
        } else {
          console.warn(`⚠️ Warning deleting auth user ${studentId}:`, deleteAuthError)
        }
      } catch (authError) {
        console.warn(`⚠️ Auth deletion failed for ${studentId} (non-critical):`, authError)
      }
    }

    console.log(`✅ Deleted ${authDeletedCount} auth users`)

    return NextResponse.json({
      success: true,
      deletedCount,
      authDeletedCount,
      message: `Deleted ${deletedCount} students successfully`
    })
  } catch (error: any) {
    console.error('❌ Error in delete all students:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete all students' },
      { status: 500 }
    )
  }
}
