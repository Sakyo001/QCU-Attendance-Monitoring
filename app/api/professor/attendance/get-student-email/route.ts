import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const studentId = request.nextUrl.searchParams.get('studentId')

    if (!studentId) {
      return NextResponse.json({ 
        error: 'Student ID is required' 
      }, { status: 400 })
    }

    console.log('📧 Fetching email for student:', studentId)

    // Get email from users table using student_id
    const { data: user, error } = await supabase
      .from('users')
      .select('email')
      .eq('student_id', studentId)
      .single()

    if (error) {
      console.error('❌ Error fetching email:', error)
      return NextResponse.json({ 
        success: false,
        email: null,
        error: error.message 
      }, { status: 200 }) // Return 200 to not break frontend
    }

    if (!user) {
      console.log('⚠️ No user found for student_id:', studentId)
      return NextResponse.json({
        success: false,
        email: null
      })
    }

    console.log('✅ Found email:', user.email)

    return NextResponse.json({
      success: true,
      email: user.email
    })
  } catch (error: any) {
    console.error('❌ Exception:', error)
    return NextResponse.json({ 
      success: false,
      email: null,
      error: error.message 
    }, { status: 200 })
  }
}
