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
        records: [],
        stats: {
          total_days: 0,
          present_days: 0,
          absent_days: 0,
          attendance_rate: 0
        }
      })
    }

    // Get all attendance records for this student using student_number
    const { data: records, error: recordsError } = await supabase
      .from('attendance_records')
      .select('id, checked_in_at, status, section_id')
      .eq('student_number', userData.student_id)
      .order('checked_in_at', { ascending: false })

    if (recordsError) {
      console.error('Error fetching attendance records:', recordsError)
      return NextResponse.json({ 
        success: true,
        records: [],
        stats: {
          total_days: 0,
          present_days: 0,
          absent_days: 0,
          attendance_rate: 0
        }
      })
    }

    if (!records || records.length === 0) {
      return NextResponse.json({ 
        success: true,
        records: [],
        stats: {
          total_days: 0,
          present_days: 0,
          absent_days: 0,
          attendance_rate: 0
        }
      })
    }

    // Get section details for each record
    const recordsWithSection = await Promise.all(
      records.map(async (record) => {
        const { data: section } = await supabase
          .from('sections')
          .select('section_code, semester, academic_year')
          .eq('id', record.section_id)
          .limit(1)

        return {
          id: record.id,
          date: record.checked_in_at,
          status: record.status,
          section_code: section?.[0]?.section_code || 'Unknown',
          semester: section?.[0]?.semester || '',
          academic_year: section?.[0]?.academic_year || ''
        }
      })
    )

    // Calculate stats
    const totalDays = records.length
    const presentDays = records.filter(r => r.status === 'present').length
    const absentDays = totalDays - presentDays
    const attendanceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0

    return NextResponse.json({ 
      success: true,
      records: recordsWithSection,
      stats: {
        total_days: totalDays,
        present_days: presentDays,
        absent_days: absentDays,
        attendance_rate: attendanceRate
      }
    })

  } catch (error: any) {
    console.error('Exception in attendance records fetch:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch attendance records' 
    }, { status: 500 })
  }
}
