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

    // Prefer email from student_face_registrations (personal email from Excel col 18)
    // Fall back to users.email (MS365 institutional account) only if not found
    const { data: reg } = await supabase
      .from('student_face_registrations')
      .select('email')
      .eq('student_number', studentId)
      .maybeSingle()

    if (reg?.email) {
      console.log('✅ Found personal email from face registration:', reg.email)
      return NextResponse.json({ success: true, email: reg.email })
    }

    // Fallback: institutional email from users table
    const { data: user, error } = await supabase
      .from('users')
      .select('email')
      .eq('student_id', studentId)
      .single()

    if (error || !user) {
      console.log('⚠️ No email found for student_id:', studentId)
      return NextResponse.json({ success: false, email: null })
    }

    console.log('✅ Falling back to institutional email:', user.email)

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
