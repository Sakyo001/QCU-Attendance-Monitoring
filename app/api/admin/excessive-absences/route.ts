import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

type RiskLevel = 'normal' | 'watch' | 'excessive' | 'habitual'

type MonitorStudent = {
  studentId: string | null
  studentNumber: string
  firstName: string
  lastName: string
  fullName: string
  email: string | null
  isActive: boolean
  sectionCodes: string[]
  absentCount: number
  lateCount: number
  presentCount: number
  totalRecords: number
  lastAbsentAt: string | null
  meetsThreshold: boolean
  riskLevel: RiskLevel
}

type MonitorSummary = {
  totalTrackedStudents: number
  totalAbsences: number
  flaggedStudents: number
  habitualStudents: number
  watchlistStudents: number
  emailableFlaggedStudents: number
}

type BuildDataOptions = {
  threshold: number
  dateFrom?: string | null
  dateTo?: string | null
  studentNumberFilter?: string | null
}

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

type AttendanceRecordRow = {
  student_number: string | null
  status: string | null
  section_id: string | null
  checked_in_at: string | null
}

type UserRow = {
  id: string
  student_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  is_active: boolean | null
}

type SectionRow = {
  id: string
  section_code: string | null
}

type AggregateEntry = {
  absentCount: number
  lateCount: number
  presentCount: number
  totalRecords: number
  sectionIds: Set<string>
  lastAbsentAt: string | null
}

function normalizeThreshold(rawValue: string | null | undefined): number {
  if (!rawValue) return 3
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed < 1) return 3
  return Math.floor(parsed)
}

function classifyRisk(absentCount: number, threshold: number): RiskLevel {
  if (absentCount >= threshold + 2) return 'habitual'
  if (absentCount >= threshold) return 'excessive'
  if (absentCount === threshold - 1) return 'watch'
  return 'normal'
}

function toIsoDayStart(dateValue: string): string {
  return `${dateValue}T00:00:00`
}

function toIsoDayEnd(dateValue: string): string {
  return `${dateValue}T23:59:59`
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function buildMonitorData(
  supabase: ServiceRoleClient,
  options: BuildDataOptions
): Promise<{ students: MonitorStudent[]; summary: MonitorSummary }> {
  const { threshold, dateFrom, dateTo, studentNumberFilter } = options

  let attendanceQuery = supabase
    .from('attendance_records')
    .select('student_number, status, section_id, checked_in_at')

  if (studentNumberFilter) {
    attendanceQuery = attendanceQuery.eq('student_number', studentNumberFilter)
  }
  if (dateFrom) {
    attendanceQuery = attendanceQuery.gte('checked_in_at', toIsoDayStart(dateFrom))
  }
  if (dateTo) {
    attendanceQuery = attendanceQuery.lte('checked_in_at', toIsoDayEnd(dateTo))
  }

  const { data: rawAttendance, error: attendanceError } = await attendanceQuery

  if (attendanceError) {
    throw new Error(attendanceError.message || 'Failed to fetch attendance records')
  }

  const attendanceRecords = ((rawAttendance || []) as AttendanceRecordRow[]).filter(
    (record) => typeof record.student_number === 'string' && record.student_number.length > 0
  )

  if (attendanceRecords.length === 0) {
    return {
      students: [],
      summary: {
        totalTrackedStudents: 0,
        totalAbsences: 0,
        flaggedStudents: 0,
        habitualStudents: 0,
        watchlistStudents: 0,
        emailableFlaggedStudents: 0,
      },
    }
  }

  const aggregateMap = new Map<string, AggregateEntry>()

  for (const record of attendanceRecords) {
    const studentNumber = String(record.student_number)
    const status = String(record.status || '').toLowerCase()
    const checkedInAt = record.checked_in_at ? String(record.checked_in_at) : null

    if (!aggregateMap.has(studentNumber)) {
      aggregateMap.set(studentNumber, {
        absentCount: 0,
        lateCount: 0,
        presentCount: 0,
        totalRecords: 0,
        sectionIds: new Set<string>(),
        lastAbsentAt: null,
      })
    }

    const aggregate = aggregateMap.get(studentNumber)!
    aggregate.totalRecords += 1

    if (record.section_id) {
      aggregate.sectionIds.add(String(record.section_id))
    }

    if (status === 'absent') {
      aggregate.absentCount += 1

      if (!aggregate.lastAbsentAt || (checkedInAt && checkedInAt > aggregate.lastAbsentAt)) {
        aggregate.lastAbsentAt = checkedInAt
      }
    } else if (status === 'late') {
      aggregate.lateCount += 1
    } else if (status === 'present') {
      aggregate.presentCount += 1
    }
  }

  const studentNumbers = Array.from(aggregateMap.keys())

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, student_id, email, first_name, last_name, is_active')
    .eq('role', 'student')
    .in('student_id', studentNumbers)

  if (usersError) {
    throw new Error(usersError.message || 'Failed to fetch student profiles')
  }

  const userMap = new Map<string, UserRow>()
  for (const user of (users || []) as UserRow[]) {
    if (user.student_id) {
      userMap.set(String(user.student_id), user)
    }
  }

  const sectionIds = new Set<string>()
  for (const aggregate of aggregateMap.values()) {
    for (const sectionId of aggregate.sectionIds) {
      sectionIds.add(sectionId)
    }
  }

  const sectionMap = new Map<string, string>()
  if (sectionIds.size > 0) {
    const { data: sections, error: sectionsError } = await supabase
      .from('sections')
      .select('id, section_code')
      .in('id', Array.from(sectionIds))

    if (sectionsError) {
      throw new Error(sectionsError.message || 'Failed to fetch sections')
    }

    for (const section of (sections || []) as SectionRow[]) {
      const sectionId = String(section.id)
      const sectionCode = section.section_code ? String(section.section_code).trim() : ''

      if (!sectionCode) {
        continue
      }

      sectionMap.set(sectionId, sectionCode)
      sectionMap.set(sectionCode, sectionCode)
    }
  }

  const students: MonitorStudent[] = []

  for (const [studentNumber, aggregate] of aggregateMap.entries()) {
    const user = userMap.get(studentNumber)

    const sectionCodes = Array.from(
      new Set(
        Array.from(aggregate.sectionIds)
          .map((rawSectionId) => {
            const sectionValue = String(rawSectionId).trim()

            if (!sectionValue) {
              return null
            }

            const mappedSectionCode = sectionMap.get(sectionValue)
            if (mappedSectionCode) {
              return mappedSectionCode
            }

            if (isUuidLike(sectionValue)) {
              return null
            }

            return sectionValue
          })
          .filter((sectionCode): sectionCode is string => Boolean(sectionCode))
      )
    ).sort((a, b) => a.localeCompare(b))

    const riskLevel = classifyRisk(aggregate.absentCount, threshold)
    const meetsThreshold = aggregate.absentCount >= threshold

    if (aggregate.absentCount === 0) {
      continue
    }

    const firstName = user?.first_name ? String(user.first_name) : 'Unknown'
    const lastName = user?.last_name ? String(user.last_name) : 'Student'

    students.push({
      studentId: user?.id ? String(user.id) : null,
      studentNumber,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      email: user?.email ? String(user.email) : null,
      isActive: user?.is_active !== false,
      sectionCodes,
      absentCount: aggregate.absentCount,
      lateCount: aggregate.lateCount,
      presentCount: aggregate.presentCount,
      totalRecords: aggregate.totalRecords,
      lastAbsentAt: aggregate.lastAbsentAt,
      meetsThreshold,
      riskLevel,
    })
  }

  students.sort((a, b) => {
    if (b.absentCount !== a.absentCount) return b.absentCount - a.absentCount
    if (b.lateCount !== a.lateCount) return b.lateCount - a.lateCount
    return a.fullName.localeCompare(b.fullName)
  })

  const summary: MonitorSummary = {
    totalTrackedStudents: students.length,
    totalAbsences: students.reduce((total, student) => total + student.absentCount, 0),
    flaggedStudents: students.filter((student) => student.meetsThreshold).length,
    habitualStudents: students.filter((student) => student.riskLevel === 'habitual').length,
    watchlistStudents: students.filter((student) => student.riskLevel === 'watch').length,
    emailableFlaggedStudents: students.filter(
      (student) => student.meetsThreshold && !!student.email
    ).length,
  }

  return { students, summary }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()
    const threshold = normalizeThreshold(request.nextUrl.searchParams.get('threshold'))
    const dateFrom = request.nextUrl.searchParams.get('dateFrom')
    const dateTo = request.nextUrl.searchParams.get('dateTo')

    const { students, summary } = await buildMonitorData(supabase, {
      threshold,
      dateFrom,
      dateTo,
    })

    return NextResponse.json({
      success: true,
      threshold,
      dateFrom,
      dateTo,
      summary,
      students,
    })
  } catch (error: unknown) {
    console.error('❌ Excessive absence monitor GET failed:', error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to load monitor data') },
      { status: 500 }
    )
  }
}

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Direct server-side email sending is disabled. Use Gmail draft compose from the admin page.',
    },
    { status: 405 }
  )
}
