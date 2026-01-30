import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()
    const dateFrom = request.nextUrl.searchParams.get('dateFrom')
    const dateTo = request.nextUrl.searchParams.get('dateTo')

    console.log('📊 Fetching attendance reports:', { dateFrom, dateTo })

    // Fetch all attendance records
    let attendanceQuery = supabase
      .from('attendance_records')
      .select('id, student_number, status, section_id, checked_in_at, face_match_confidence')

    if (dateFrom) {
      // For session-based approach, we'll filter by checked_in_at
      attendanceQuery = attendanceQuery.gte('checked_in_at', dateFrom + 'T00:00:00')
    }
    if (dateTo) {
      attendanceQuery = attendanceQuery.lte('checked_in_at', dateTo + 'T23:59:59')
    }

    const { data: allAttendance, error: attendanceError } = await attendanceQuery

    if (attendanceError) {
      console.error('Error fetching attendance records:', attendanceError)
      throw attendanceError
    }

    console.log('✅ Found', allAttendance?.length || 0, 'attendance records')

    // Calculate overall stats
    const presentCount = (allAttendance as any)?.filter((r: any) => r.status === 'present').length || 0
    const absentCount = (allAttendance as any)?.filter((r: any) => r.status === 'absent').length || 0
    const lateCount = (allAttendance as any)?.filter((r: any) => r.status === 'late').length || 0
    const totalRecords = allAttendance?.length || 0

    const overallStats = {
      totalRecords,
      presentCount,
      absentCount,
      lateCount,
      attendanceRate: totalRecords > 0 ? (presentCount / totalRecords) * 100 : 0,
    }

    // Fetch all sections with their data
    const { data: sections, error: sectionsError } = await supabase
      .from('sections')
      .select('id, section_code, course_id, semester')

    if (sectionsError) {
      console.error('Error fetching sections:', sectionsError)
      throw sectionsError
    }

    console.log('✅ Found', sections?.length || 0, 'sections')

    // Fetch professor details
    const { data: professors, error: professorsError } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('role', 'professor')

    if (professorsError) {
      console.warn('Warning fetching professors:', professorsError)
    }

    const professorMap = new Map(
      professors?.map((p: any) => [p.id, `${p.first_name} ${p.last_name}`]) ?? []
    )

    // Build section-wise reports
    const sectionReports = sections?.map((section: any) => {
      const sectionAttendance = allAttendance?.filter(
        (r: any) => r.section_id === section.id || r.section_id === section.id.toString()
      ) || []

      const presentInSection = sectionAttendance.filter(
        (r: any) => r.status === 'present'
      ).length

      return {
        id: section.id,
        section_name: section.section_code,
        course_code: section.course_id ? `Course-${section.course_id.substring(0, 8)}` : 'N/A',
        professor_name: 'Unassigned',
        total_attendance_records: sectionAttendance.length,
        present_count: presentInSection,
        absent_count: sectionAttendance.filter((r: any) => r.status === 'absent').length,
        late_count: sectionAttendance.filter((r: any) => r.status === 'late').length,
        attendance_rate:
          sectionAttendance.length > 0
            ? (presentInSection / sectionAttendance.length) * 100
            : 0,
      }
    }) || []

    console.log('✅ Generated', sectionReports.length, 'section reports')

    return NextResponse.json({
      success: true,
      stats: overallStats,
      sections: sectionReports,
    })
  } catch (error: any) {
    console.error('❌ Error generating reports:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate reports' },
      { status: 500 }
    )
  }
}
