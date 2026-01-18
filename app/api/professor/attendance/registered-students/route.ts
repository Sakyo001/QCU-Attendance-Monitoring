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

    // First, fetch the section code from the sections table
    const { data: sectionData, error: sectionError } = await supabase
      .from('sections')
      .select('section_code')
      .eq('id', sectionId)
      .single()

    if (sectionError || !sectionData) {
      console.error('❌ Section not found:', sectionError)
      return NextResponse.json({ 
        error: 'Section not found' 
      }, { status: 404 })
    }

    const sectionCode = sectionData.section_code
    console.log('✅ Found section code:', sectionCode)

    // Get all registered students in this section using the section code
    const { data: students, error } = await supabase
      .from('student_face_registrations')
      .select('id, first_name, last_name, student_number, registered_at')
      .eq('section_id', sectionCode)
      .order('last_name', { ascending: true })

    if (error) {
      console.error('❌ Error fetching students:', error)
      return NextResponse.json({ 
        error: error.message 
      }, { status: 500 })
    }

    console.log('✅ Found registered students:', students?.length || 0)

    return NextResponse.json({
      success: true,
      students: students || []
    })
  } catch (error: any) {
    console.error('❌ Exception:', error)
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 })
  }
}
