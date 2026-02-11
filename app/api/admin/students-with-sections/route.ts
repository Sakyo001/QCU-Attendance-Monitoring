import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()

    // Fetch all students from student_face_registrations with section info
    const { data: faceRegs, error: faceRegsError } = await supabase
      .from('student_face_registrations')
      .select('student_number, first_name, last_name, section_id, is_active')
      .order('first_name', { ascending: true })

    if (faceRegsError) {
      console.error('❌ Face registrations fetch error:', faceRegsError)
      return NextResponse.json(
        { error: faceRegsError.message },
        { status: 400 }
      )
    }

    if (!faceRegs || faceRegs.length === 0) {
      console.log('⚠️ No face registrations found')
      return NextResponse.json([])
    }

    console.log('✅ Face registrations fetched:', faceRegs.length)

    // Get all sections
    const { data: sections, error: sectionsError } = await supabase
      .from('sections')
      .select('id, section_code')

    if (sectionsError) {
      console.error('❌ Sections fetch error:', sectionsError)
      return NextResponse.json(
        { error: sectionsError.message },
        { status: 400 }
      )
    }

    const sectionsMap = new Map(
      sections?.map(s => [s.id, s.section_code]) || []
    )

    // Get emails from users table
    const studentNumbers = faceRegs.map(f => f.student_number)
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('student_id, email')
      .in('student_id', studentNumbers)

    const emailMap = new Map(
      usersData?.map(u => [u.student_id, u.email]) || []
    )

    // Combine all data
    const studentsWithSections = faceRegs.map(reg => ({
      id: reg.student_number,
      first_name: reg.first_name,
      last_name: reg.last_name,
      email: emailMap.get(reg.student_number) || `${reg.student_number}@student.edu`,
      student_id: reg.student_number,
      is_active: reg.is_active ?? true,
      section_id: reg.section_id,
      section_code: reg.section_id ? sectionsMap.get(reg.section_id) : undefined
    }))

    return NextResponse.json(studentsWithSections)
  } catch (error: any) {
    console.error('❌ Exception in students-with-sections:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch students with sections' },
      { status: 500 }
    )
  }
}
