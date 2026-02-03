import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function PUT(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    
    const { userId, firstName, lastName, studentId, email } = body

    if (!userId || !firstName || !lastName || !studentId) {
      return NextResponse.json({ 
        error: 'Missing required fields' 
      }, { status: 400 })
    }

    console.log('📝 Updating student information:')
    console.log('   - User ID:', userId)
    console.log('   - Name:', firstName, lastName)
    console.log('   - Student ID:', studentId)
    console.log('   - Email:', email)

    // Update in student_face_registrations table
    const { data: faceRegData, error: faceRegError } = await supabase
      .from('student_face_registrations')
      .update({
        first_name: firstName,
        last_name: lastName,
        student_number: studentId,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()

    if (faceRegError) {
      console.error('❌ Error updating student_face_registrations:', faceRegError)
      return NextResponse.json({ 
        error: 'Failed to update face registration' 
      }, { status: 500 })
    }

    // Update in users table (if this is linked to a user account)
    const updateData: any = {
      first_name: firstName,
      last_name: lastName,
      student_id: studentId,
      updated_at: new Date().toISOString()
    }
    
    if (email) {
      updateData.email = email
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .update(updateData)
      .eq('student_id', studentId)
      .select()

    if (userError) {
      console.error('❌ Error updating users table:', userError)
      // Don't fail if user update fails - student_face_registrations is the main table
    } else if (userData && userData.length > 0) {
      console.log('✅ Updated users table for:', userData.length, 'user(s)')
    }

    console.log('✅ Successfully updated student information')

    return NextResponse.json({
      success: true,
      message: 'Student information updated successfully',
      data: faceRegData
    })
  } catch (error: any) {
    console.error('❌ Exception:', error)
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 })
  }
}
