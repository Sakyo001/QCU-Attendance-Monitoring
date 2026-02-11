import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)
    const sectionId = searchParams.get('sectionId')
    const professorId = searchParams.get('professorId')

    if (!sectionId && !professorId) {
      return NextResponse.json({ error: 'sectionId or professorId required' }, { status: 400 })
    }

    // If professorId provided, get all sections for this professor
    let sectionIds: string[] = []
    if (professorId) {
      const { data: sessions } = await supabase
        .from('class_sessions')
        .select('section_id')
        .eq('professor_id', professorId)
      sectionIds = [...new Set((sessions || []).map((s: any) => s.section_id))]
    } else if (sectionId) {
      sectionIds = [sectionId]
    }

    if (sectionIds.length === 0) {
      return NextResponse.json({
        success: true,
        summary: { present: 0, late: 0, absent: 0, total: 0 },
        sections: []
      })
    }

    // Get all attendance records for these sections
    const { data: records, error } = await supabase
      .from('attendance_records')
      .select('id, student_number, status, checked_in_at, section_id')
      .in('section_id', sectionIds)

    if (error) {
      console.error('Error fetching attendance summary:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get total registered students per section
    const sectionStats: Record<string, { present: number; late: number; absent: number; total: number; section_code: string }> = {}

    for (const sid of sectionIds) {
      const { count: totalStudents } = await supabase
        .from('student_face_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('section_id', sid)
        .eq('is_active', true)

      // Get section code
      const { data: sectionData } = await supabase
        .from('sections')
        .select('section_code')
        .eq('id', sid)
        .single()

      const sectionRecords = (records || []).filter((r: any) => r.section_id === sid)
      
      // Get unique student numbers with attendance today
      const todayDate = new Date().toISOString().split('T')[0]
      const todayRecords = sectionRecords.filter((r: any) => 
        r.checked_in_at && r.checked_in_at.split('T')[0] === todayDate
      )

      const present = todayRecords.filter((r: any) => r.status === 'present').length
      const late = todayRecords.filter((r: any) => r.status === 'late').length
      const total = totalStudents || 0
      const absent = Math.max(0, total - present - late)

      sectionStats[sid] = {
        present,
        late,
        absent,
        total,
        section_code: (sectionData as any)?.section_code || sid
      }
    }

    // Overall summary
    const summary = Object.values(sectionStats).reduce(
      (acc, s) => ({
        present: acc.present + s.present,
        late: acc.late + s.late,
        absent: acc.absent + s.absent,
        total: acc.total + s.total
      }),
      { present: 0, late: 0, absent: 0, total: 0 }
    )

    return NextResponse.json({
      success: true,
      summary,
      sections: Object.entries(sectionStats).map(([id, stats]) => ({
        id,
        ...stats
      }))
    })
  } catch (error) {
    console.error('Error in attendance summary:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
