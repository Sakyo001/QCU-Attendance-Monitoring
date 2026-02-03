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

    // First, get the student_number from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('student_id')
      .eq('id', studentId)
      .single()

    if (userError || !userData?.student_id) {
      return NextResponse.json({ 
        success: true,
        classmates: [],
        message: 'Student not found'
      })
    }

    // Get the student's section from student_face_registrations
    const { data: studentSection, error: sectionError } = await supabase
      .from('student_face_registrations')
      .select('section_id')
      .eq('student_number', userData.student_id)
      .limit(1)

    if (sectionError && sectionError.code !== 'PGRST116') {
      console.error('Error fetching student section:', sectionError)
      return NextResponse.json({ 
        success: true,
        classmates: [],
        message: 'Failed to fetch student section'
      })
    }

    console.log('🔍 Classmates endpoint - studentSection:', {
      found: !!studentSection,
      length: studentSection?.length || 0,
      data: studentSection
    })

    if (!studentSection || studentSection.length === 0 || !studentSection[0]?.section_id) {
      console.log('❌ No section found for student:', userData.student_id)
      console.log('   studentSection data:', studentSection)
      return NextResponse.json({ 
        success: true,
        classmates: [],
        message: 'Student not enrolled in any section'
      })
    }

    const sectionId = studentSection[0].section_id
    console.log('📌 Found section_id:', sectionId)

    // Get all students in the same section
    const { data: classmates, error: classmatesError } = await supabase
      .from('student_face_registrations')
      .select('student_number, first_name, last_name, registered_at')
      .eq('section_id', sectionId)
      .order('last_name', { ascending: true })

    if (classmatesError) {
      console.error('Error fetching classmates:', classmatesError)
      return NextResponse.json({ 
        success: true,
        classmates: [],
        message: 'Failed to fetch classmates'
      })
    }

    if (!classmates || classmates.length === 0) {
      return NextResponse.json({ 
        success: true,
        classmates: []
      })
    }

    // Get attendance stats for each classmate
    const classmatesWithStats = await Promise.all(
      classmates.map(async (classmate) => {
        const { data: attendanceRecords } = await supabase
          .from('attendance_records')
          .select('status')
          .eq('student_number', classmate.student_number)
          .eq('section_id', sectionId)

        const totalDays = attendanceRecords?.length || 0
        const presentDays = attendanceRecords?.filter(r => r.status === 'present').length || 0
        const attendanceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0

        return {
          first_name: classmate.first_name,
          last_name: classmate.last_name,
          student_number: classmate.student_number,
          registered_at: classmate.registered_at,
          attendance_stats: {
            total_days: totalDays,
            present_days: presentDays,
            absent_days: totalDays - presentDays,
            attendance_rate: attendanceRate
          }
        }
      })
    )

    return NextResponse.json({ 
      success: true,
      classmates: classmatesWithStats
    })

  } catch (error: any) {
    console.error('Exception in classmates fetch:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch classmates' 
    }, { status: 500 })
  }
}
