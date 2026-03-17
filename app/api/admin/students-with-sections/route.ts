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
      ((sections as any[]) || []).map((s: any) => [s.id, s.section_code])
    )

    // Get user UUID and emails from users table
    const studentNumbers = ((faceRegs as any[]) || []).map((f: any) => f.student_number)
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('id, student_id, email')
      .in('student_id', studentNumbers)

    const userMap = new Map(
      ((usersData as any[]) || []).map((u: any) => [u.student_id, { id: u.id, email: u.email }])
    )

    // Combine all data - only include students with valid user records
    const studentsWithSections = ((faceRegs as any[]) || []).map((reg: any) => {
      const userData = userMap.get(reg.student_number)
      // Only return students who have a user UUID in the database
      if (!userData || !userData.id) {
        return null
      }
      return {
        id: userData.id,
        first_name: reg.first_name,
        last_name: reg.last_name,
        email: userData.email,
        student_id: reg.student_number,
        is_active: reg.is_active ?? true,
        section_id: reg.section_id,
        section_code: reg.section_id ? sectionsMap.get(reg.section_id) : undefined
      }
    }).filter((s: any) => s !== null)

    return NextResponse.json(studentsWithSections)
  } catch (error: any) {
    console.error('❌ Exception in students-with-sections:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch students with sections' },
      { status: 500 }
    )
  }
}
