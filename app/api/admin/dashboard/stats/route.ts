import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()

    // Fetch total students
    const { count: studentCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'student')

    // Fetch total professors
    const { count: professorCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'professor')

    // Fetch total sections
    const { count: sectionCount } = await supabase
      .from('sections')
      .select('*', { count: 'exact', head: true })

    // Calculate attendance rate - get all attendance records and calculate percentage
    const { data: attendanceData, error: attendanceError } = await supabase
      .from('attendance')
      .select('status')
      .eq('status', 'present')

    const { data: totalAttendanceData, error: totalError } = await supabase
      .from('attendance')
      .select('id')

    let attendanceRate = 0
    if (!attendanceError && !totalError && totalAttendanceData && totalAttendanceData.length > 0) {
      const presentCount = attendanceData?.length || 0
      attendanceRate = Math.round((presentCount / totalAttendanceData.length) * 100)
    }

    return NextResponse.json({
      totalStudents: studentCount || 0,
      totalProfessors: professorCount || 0,
      totalSections: sectionCount || 0,
      attendanceRate: attendanceRate,
    })
  } catch (error: any) {
    console.error('Exception in dashboard stats:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch dashboard stats' },
      { status: 500 }
    )
  }
}
