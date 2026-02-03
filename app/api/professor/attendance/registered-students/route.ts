import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const sectionId = request.nextUrl.searchParams.get('sectionId')

    if (!sectionId) {
      return NextResponse.json({ 
        error: 'Section ID is required' 
      }, { status: 400 })
    }

    console.log('📝 Fetching registered students for section:', sectionId)

    // Get all registered students in this section from student_face_registrations
    // Filter by section_id to only show students registered for this specific section
    const { data: students, error } = await supabase
      .from('student_face_registrations')
      .select('id, first_name, last_name, student_number, registered_at')
      .eq('section_id', sectionId)
      .eq('is_active', true)
      .order('last_name', { ascending: true })

    if (error) {
      console.error('❌ Error fetching students:', error)
      return NextResponse.json({ 
        error: error.message 
      }, { status: 500 })
    }

    // Rename student_number to student_id for frontend consistency
    const registeredStudents = (students || []).map(student => ({
      ...student,
      student_id: student.student_number
    }))

    console.log('✅ Found registered students for section:', registeredStudents.length)
    console.log('📦 Sample student data:', registeredStudents[0])
    console.log('📦 Student keys:', registeredStudents[0] ? Object.keys(registeredStudents[0]) : 'N/A')

    return NextResponse.json({
      success: true,
      students: registeredStudents
    })
  } catch (error: any) {
    console.error('❌ Exception:', error)
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 })
  }
}
