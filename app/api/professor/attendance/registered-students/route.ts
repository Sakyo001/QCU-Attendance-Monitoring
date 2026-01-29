import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function GET(request: NextRequest) {
  try {
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

    const registeredStudents = students || []

    console.log('✅ Found registered students for section:', registeredStudents.length)

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
