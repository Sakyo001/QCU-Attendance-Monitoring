import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

// GET /api/professor/attendance/export
// Query params:
//   professorId  – required
//   sectionIds   – comma-separated section UUIDs
//   dateFrom     – YYYY-MM-DD  (inclusive)
//   dateTo       – YYYY-MM-DD  (inclusive)
//   subjectCode  – optional filter
//   semester     – optional filter
//   academicYear – optional filter
//   status       – optional: present | late | absent

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)

    const professorId  = searchParams.get('professorId')
    const sectionIdsRaw = searchParams.get('sectionIds') || ''
    const dateFrom     = searchParams.get('dateFrom')
    const dateTo       = searchParams.get('dateTo')
    const subjectCode  = searchParams.get('subjectCode') || ''
    const semester     = searchParams.get('semester') || ''
    const academicYear = searchParams.get('academicYear') || ''
    const statusFilter = searchParams.get('status') || ''

    if (!professorId) {
      return NextResponse.json({ error: 'professorId is required' }, { status: 400 })
    }
    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 })
    }

    // ── 1. Get all classrooms for this professor ─────────────────────────────
    let classroomsQuery = supabase
      .from('class_sessions')
      .select('id, section_id, subject_code, subject_name, sections(id, section_code, semester, academic_year)')
      .eq('professor_id', professorId)

    const { data: classrooms, error: classError } = await classroomsQuery
    if (classError) {
      return NextResponse.json({ error: classError.message }, { status: 500 })
    }

    // Build a map: sectionId → { sectionCode, semester, academicYear, subjectCodes }
    const sectionMap = new Map<string, {
      sectionCode: string
      semester: string
      academicYear: string
      subjectCodes: string[]
      subjectNames: string[]
    }>()

    ;(classrooms || []).forEach((c: any) => {
      const sid = c.section_id
      const sec = c.sections
      if (!sec) return
      if (!sectionMap.has(sid)) {
        sectionMap.set(sid, {
          sectionCode: sec.section_code,
          semester: sec.semester || '',
          academicYear: sec.academic_year || '',
          subjectCodes: [],
          subjectNames: [],
        })
      }
      const entry = sectionMap.get(sid)!
      if (c.subject_code && !entry.subjectCodes.includes(c.subject_code)) {
        entry.subjectCodes.push(c.subject_code)
      }
      if (c.subject_name && !entry.subjectNames.includes(c.subject_name)) {
        entry.subjectNames.push(c.subject_name)
      }
    })

    // ── 2. Resolve which section IDs to query ────────────────────────────────
    // Apply optional top-level filters (subjectCode, semester, academicYear)
    let eligibleSectionIds = Array.from(sectionMap.entries())
      .filter(([, info]) => {
        if (semester && info.semester !== semester) return false
        if (academicYear && info.academicYear !== academicYear) return false
        if (subjectCode && !info.subjectCodes.includes(subjectCode)) return false
        return true
      })
      .map(([id]) => id)

    // If caller specified explicit sectionIds, intersect
    if (sectionIdsRaw) {
      const requested = new Set(sectionIdsRaw.split(',').map(s => s.trim()).filter(Boolean))
      eligibleSectionIds = eligibleSectionIds.filter(id => requested.has(id))
    }

    if (eligibleSectionIds.length === 0) {
      return NextResponse.json({ success: true, rows: [], total: 0 })
    }

    // ── 3. Fetch all enrolled students for these sections ────────────────────
    const { data: students, error: studErr } = await supabase
      .from('student_face_registrations')
      .select('id, student_number, first_name, last_name, section_id')
      .eq('is_active', true)
      .in('section_id', eligibleSectionIds)

    if (studErr) {
      return NextResponse.json({ error: studErr.message }, { status: 500 })
    }

    // Map student by id
    const studentById = new Map((students || []).map((s: any) => [s.id, s]))
    // Map students by section
    const studentsBySection = new Map<string, any[]>()
    ;(students || []).forEach((s: any) => {
      if (!studentsBySection.has(s.section_id)) studentsBySection.set(s.section_id, [])
      studentsBySection.get(s.section_id)!.push(s)
    })

    // ── 4. Fetch attendance records for these sections in date range ──────────
    // checked_in_at is a timestamptz; filter: >= dateFrom 00:00 and < dateTo+1 00:00
    const dateFromTs = `${dateFrom}T00:00:00.000Z`
    const dateToTs   = `${dateTo}T23:59:59.999Z`

    let recordsQuery = supabase
      .from('attendance_records')
      .select('id, student_registration_id, student_number, section_id, status, checked_in_at, face_match_confidence')
      .in('section_id', eligibleSectionIds)
      .gte('checked_in_at', dateFromTs)
      .lte('checked_in_at', dateToTs)
      .order('checked_in_at', { ascending: true })

    if (statusFilter) {
      recordsQuery = recordsQuery.eq('status', statusFilter)
    }

    const { data: records, error: recErr } = await recordsQuery
    if (recErr) {
      return NextResponse.json({ error: recErr.message }, { status: 500 })
    }

    // ── 5. Build result rows ─────────────────────────────────────────────────
    // Key: sectionId+studentNumber+date → record (keep last in case of duplicates)
    const recordKey = (sectionId: string, studentNumber: string, date: string) =>
      `${sectionId}__${studentNumber}__${date}`

    const recordMap = new Map<string, any>()
    ;(records || []).forEach((r: any) => {
      const date = r.checked_in_at ? r.checked_in_at.split('T')[0] : ''
      if (!date) return
      const key = recordKey(r.section_id, r.student_number, date)
      recordMap.set(key, r)
    })

    // Collect all dates that have any records in this range
    const datesWithRecords = new Set<string>()
    ;(records || []).forEach((r: any) => {
      const date = r.checked_in_at ? r.checked_in_at.split('T')[0] : ''
      if (date) datesWithRecords.add(date)
    })

    // Build flat rows: for each section × student × date(with records)
    const rows: any[] = []

    eligibleSectionIds.forEach(sectionId => {
      const secInfo = sectionMap.get(sectionId)!
      const sectionStudents = studentsBySection.get(sectionId) || []

      datesWithRecords.forEach(date => {
        sectionStudents.forEach(student => {
          const key = recordKey(sectionId, student.student_number, date)
          const rec = recordMap.get(key)

          const status: string = rec?.status || 'absent'

          // Apply status filter at row level
          if (statusFilter && status !== statusFilter) return

          rows.push({
            date,
            sectionCode: secInfo.sectionCode,
            semester: secInfo.semester,
            academicYear: secInfo.academicYear,
            subjectCode: secInfo.subjectCodes.join(', '),
            subjectName: secInfo.subjectNames.join(', '),
            studentNumber: student.student_number,
            lastName: student.last_name,
            firstName: student.first_name,
            status,
            checkedInAt: rec?.checked_in_at || null,
            faceMatchConfidence: rec?.face_match_confidence || null,
          })
        })
      })
    })

    // Sort: date, sectionCode, last name
    rows.sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.sectionCode.localeCompare(b.sectionCode) ||
      a.lastName.localeCompare(b.lastName)
    )

    return NextResponse.json({ success: true, rows, total: rows.length })
  } catch (error: any) {
    console.error('Export attendance error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
