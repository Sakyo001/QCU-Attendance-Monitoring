import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()

    console.log('📊 Fetching comprehensive dashboard statistics...')

    // Get total students
    const { count: totalStudents } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'student')

    // Get total professors
    const { count: totalProfessors } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'professor')

    // Get total sections
    const { count: totalSections } = await supabase
      .from('sections')
      .select('*', { count: 'exact', head: true })

    // Get today's date
    const today = new Date().toISOString().split('T')[0]

    // Get today's attendance records
    const { data: todayAttendance, count: todayAttendanceCount } = await supabase
      .from('attendance_records')
      .select('*', { count: 'exact' })
      .gte('checked_in_at', today + 'T00:00:00')
      .lte('checked_in_at', today + 'T23:59:59')

    const todayPresent = todayAttendance?.filter(r => r.status === 'present').length || 0
    const todayAbsent = todayAttendance?.filter(r => r.status === 'absent').length || 0
    const todayLate = todayAttendance?.filter(r => r.status === 'late').length || 0

    // Get total attendance records (all time)
    const { count: totalAttendanceRecords } = await supabase
      .from('attendance_records')
      .select('*', { count: 'exact', head: true })

    const { data: allAttendance } = await supabase
      .from('attendance_records')
      .select('status')

    const totalPresent = allAttendance?.filter(r => r.status === 'present').length || 0
    const overallAttendanceRate = allAttendance && allAttendance.length > 0
      ? (totalPresent / allAttendance.length) * 100
      : 0

    // Get active face registrations
    const { count: registeredStudents } = await supabase
      .from('student_face_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)

    // Get recent attendance records (last 10)
    const { data: recentActivity } = await supabase
      .from('attendance_records')
      .select('id, student_number, status, checked_in_at, section_id')
      .order('checked_in_at', { ascending: false })
      .limit(10)

    // Get student names for recent activity
    const studentNumbers = recentActivity?.map(r => r.student_number) || []
    const { data: students } = await supabase
      .from('student_face_registrations')
      .select('student_number, first_name, last_name')
      .in('student_number', studentNumbers)

    const studentMap = new Map(
      students?.map(s => [s.student_number, `${s.first_name} ${s.last_name}`]) || []
    )

    // Get section codes
    const sectionIds = recentActivity?.map(r => r.section_id).filter(Boolean) || []
    const { data: sections } = await supabase
      .from('sections')
      .select('id, section_code')
      .in('id', sectionIds)

    const sectionMap = new Map(
      sections?.map(s => [s.id, s.section_code]) || []
    )

    const enrichedActivity = recentActivity?.map(activity => ({
      id: activity.id,
      studentName: studentMap.get(activity.student_number) || activity.student_number,
      studentNumber: activity.student_number,
      status: activity.status,
      timestamp: activity.checked_in_at,
      section: sectionMap.get(activity.section_id) || 'N/A'
    })) || []

    console.log('✅ Dashboard stats compiled successfully')

    return NextResponse.json({
      totalStudents: totalStudents || 0,
      totalProfessors: totalProfessors || 0,
      totalSections: totalSections || 0,
      registeredStudents: registeredStudents || 0,
      totalAttendanceRecords: totalAttendanceRecords || 0,
      overallAttendanceRate: overallAttendanceRate,
      today: {
        total: todayAttendanceCount || 0,
        present: todayPresent,
        absent: todayAbsent,
        late: todayLate,
        attendanceRate: todayAttendanceCount ? (todayPresent / todayAttendanceCount) * 100 : 0
      },
      recentActivity: enrichedActivity
    })
  } catch (error: any) {
    console.error('❌ Error fetching dashboard stats:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch dashboard stats' },
      { status: 500 }
    )
  }
}
