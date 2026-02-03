import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    
    const { userId } = body

    console.log('🗑️ Delete endpoint called')
    console.log('   - Received userId:', userId)
    console.log('   - userId type:', typeof userId)
    console.log('   - userId is null/undefined:', userId === null || userId === undefined)

    if (!userId) {
      console.error('❌ userId is missing or invalid')
      return NextResponse.json({ 
        error: 'User ID is required' 
      }, { status: 400 })
    }

    console.log('🗑️ Deleting student face registration:', userId)

    // Get student info before deletion
    const { data: studentData, error: fetchError } = await supabase
      .from('student_face_registrations')
      .select('id, first_name, last_name, student_number, section_id')
      .eq('id', userId)
      .single()

    if (fetchError || !studentData) {
      console.error('❌ Student not found:', fetchError)
      return NextResponse.json({ 
        error: 'Student face registration not found' 
      }, { status: 404 })
    }

    console.log('📋 Found student:', studentData.first_name, studentData.last_name)

    // Try to find linked user account by student_number
    const { data: linkedUser, error: userSearchError } = await supabase
      .from('users')
      .select('id, email')
      .eq('student_id', studentData.student_number)
    
    console.log('🔍 User search result:')
    console.log('   - Error:', userSearchError)
    console.log('   - Found users:', linkedUser?.length || 0)
    if (linkedUser && linkedUser.length > 0) {
      console.log('   - First user:', linkedUser[0])
    }
    
    // Use the first matching user if found
    const userToDelete = linkedUser && linkedUser.length > 0 ? linkedUser[0] : null
    
    if (userToDelete) {
      console.log('✅ Found linked user account:', userToDelete.email)
    } else {
      console.log('⚠️ No linked user account found for student_number:', studentData.student_number)
    }

    // Step 1: Delete from auth.users if linked user exists
    if (userToDelete) {
      try {
        const { error: authError } = await supabase.auth.admin.deleteUser(userToDelete.id)
        if (authError) {
          console.warn('⚠️ Could not delete from auth:', authError.message)
        } else {
          console.log('✅ Deleted from Supabase Auth:', userToDelete.email)
        }
      } catch (error) {
        console.warn('⚠️ Auth deletion error:', error)
      }
    }

    // Step 2: Hard delete from users table (if linked user exists)
    if (userToDelete) {
      const { error: userDeleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', userToDelete.id)

      if (userDeleteError) {
        console.warn('⚠️ Error deleting from users table:', userDeleteError)
      } else {
        console.log('✅ Deleted from users table:', userToDelete.id)
      }
    }

    // Step 3: Hard delete from student_face_registrations table
    const { error: faceRegDeleteError } = await supabase
      .from('student_face_registrations')
      .delete()
      .eq('id', userId)

    if (faceRegDeleteError) {
      console.error('❌ Error deleting face registration:', faceRegDeleteError)
      return NextResponse.json({ 
        error: 'Failed to delete face registration' 
      }, { status: 500 })
    }

    console.log('✅ Successfully deleted face registration for:', studentData.first_name, studentData.last_name)

    return NextResponse.json({
      success: true,
      message: 'Student face registration and associated data completely removed'
    })
  } catch (error: any) {
    console.error('❌ Exception:', error)
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 })
  }
}
