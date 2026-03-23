import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'
import { getAllOfflineSections, upsertOfflineSections } from '@/app/api/_utils/offline-kiosk-cache'

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
    let sections: any[] = []
    
    try {
      const { data: dbSections, error: sectionsError } = await supabase
        .from('sections')
        .select('id, section_code, course_id, semester')

      if (sectionsError) {
        throw sectionsError
      }

      sections = dbSections || []

      // Save to offline cache
      if (sections.length > 0) {
        const offlineSections = (sections as any[]).map((s) => ({
          id: s.id,
          sectionCode: s.section_code,
          semester: s.semester || '',
          academicYear: '',
          maxStudents: 0,
        }))
        await upsertOfflineSections(offlineSections)
        console.log('📦 Saved', offlineSections.length, 'sections to offline cache')
      }
    } catch (dbError) {
      console.warn('⚠️ Supabase unavailable, using offline section cache:', dbError)
      
      // Load from offline cache
      const offlineSections = await getAllOfflineSections()
      sections = offlineSections.map((s) => ({
        id: s.id,
        section_code: s.sectionCode,
        course_id: null,
        semester: s.semester
      }))
      console.log('📦 Loaded', sections.length, 'sections from offline cache')
    }

    console.log('✅ Found', sections?.length || 0, 'sections')

    // Fetch class-session assignments to derive course/professor per section.
    let sessionAssignments: any[] = []
    try {
      const { data: sessions, error: sessionsError } = await supabase
        .from('class_sessions')
        .select('section_id, professor_id, subject_code, subject_name')

      if (sessionsError) {
        throw sessionsError
      }

      sessionAssignments = sessions || []
      console.log('✅ Found', sessionAssignments.length, 'class session assignments')
    } catch (sessionsErr) {
      console.warn('⚠️ Could not fetch class session assignments for reports:', sessionsErr)
      sessionAssignments = []
    }

    // Fetch professor details
    const { data: professors, error: professorsError } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('role', 'professor')

    if (professorsError) {
      console.warn('Warning fetching professors:', professorsError)
    }

    const professorMap = new Map<string, string>(
      professors?.map((p: any) => [p.id, `${p.first_name} ${p.last_name}`]) ?? []
    )

    const assignmentsBySection = new Map<string, any[]>()
    for (const assignment of sessionAssignments) {
      const key = String(assignment.section_id)
      if (!assignmentsBySection.has(key)) {
        assignmentsBySection.set(key, [])
      }
      assignmentsBySection.get(key)!.push(assignment)
    }

    // Build section-wise reports
    const sectionReports = sections?.map((section: any) => {
      const sectionAttendance = allAttendance?.filter(
        (r: any) => r.section_id === section.id || r.section_id === section.id.toString()
      ) || []

      const sectionAssignments = assignmentsBySection.get(String(section.id)) || []

      const presentInSection = sectionAttendance.filter(
        (r: any) => r.status === 'present'
      ).length

      // Course display: prefer subject_code, then subject_name, then section course_id fallback.
      const subjectCode = sectionAssignments.find((a: any) => !!a.subject_code)?.subject_code
      const subjectName = sectionAssignments.find((a: any) => !!a.subject_name)?.subject_name
      const courseCode = subjectCode || subjectName || (section.course_id ? `Course-${String(section.course_id).substring(0, 8)}` : 'N/A')

      // Professor display: collect unique assigned professors for this section.
      const professorNames = Array.from(new Set(
        sectionAssignments
          .map((a: any): string | undefined => professorMap.get(a.professor_id))
          .filter((name: string | undefined): name is string => Boolean(name))
      )) as string[]

      return {
        id: section.id,
        section_name: section.section_code,
        course_code: courseCode,
        professor_name: professorNames.length > 0 ? professorNames.join(', ') : 'Unassigned',
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
