'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useMemo } from 'react'
import { ArrowLeft, BarChart3, Calendar, Users, CheckCircle, Clock, XCircle, Search, Download, ChevronLeft, ChevronRight, Eye, Filter, FileDown, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  if (/[\r\n",]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function downloadCsv(filename: string, headers: string[], rows: Array<Record<string, unknown>>) {
  const headerLine = headers.map(csvEscape).join(',')
  const lines = rows.map(r => headers.map(h => csvEscape(r[h])).join(','))
  const csv = `\ufeff${[headerLine, ...lines].join('\r\n')}\r\n`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface AvailableClassroom {
  classSessionId: string
  sectionId: string
  sectionCode: string
  subjectCode: string
  subjectName: string
  dayOfWeek: string
  semester: string
  academicYear: string
  yearLevel: string
}

interface SectionSummary {
  id: string
  section_code: string
  present: number
  late: number
  absent: number
  total: number
}

interface DailyStudent {
  id: string
  student_number: string
  first_name: string
  last_name: string
  sectionCode: string
  status: 'present' | 'late' | 'absent'
  checked_in_at: string | null
  face_match_confidence: number | null
}

interface OverallSummary {
  present: number
  late: number
  absent: number
  total: number
}

function deriveYearLevelFromSectionCode(sectionCode: string) {
  if (!sectionCode) return ''
  const m = sectionCode.match(/\d/)
  return m ? m[0] : ''
}

function formatTimeString(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function ProfessorReportsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [activeView, setActiveView] = useState<'summary' | 'daily' | 'export'>('summary')
  const [sections, setSections] = useState<SectionSummary[]>([])
  const [summary, setSummary] = useState<OverallSummary>({ present: 0, late: 0, absent: 0, total: 0 })
  const [loadingSummary, setLoadingSummary] = useState(true)

  // All classrooms enriched with subject/semester/year-level info
  const [allClassrooms, setAllClassrooms] = useState<AvailableClassroom[]>([])

  // Daily detail — multi-section
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [loadedStudents, setLoadedStudents] = useState<DailyStudent[]>([])
  const [loadingDaily, setLoadingDaily] = useState(false)

  // Export tab state
  const today = new Date().toISOString().split('T')[0]
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const [exportSectionIds, setExportSectionIds] = useState<string[]>([])
  const [exportDateFrom, setExportDateFrom] = useState(firstOfMonth)
  const [exportDateTo, setExportDateTo] = useState(today)
  const [exportSubjectCode, setExportSubjectCode] = useState('')
  const [exportSemester, setExportSemester] = useState('')
  const [exportAcademicYear, setExportAcademicYear] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [exportPreview, setExportPreview] = useState<{ rows: any[]; total: number } | null>(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterYearLevel, setFilterYearLevel] = useState('')
  const [filterSubjectCode, setFilterSubjectCode] = useState('')
  const [filterSemester, setFilterSemester] = useState('')
  const [filterAcademicYear, setFilterAcademicYear] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Derived dropdown options
  const uniqueYearLevels = useMemo(() =>
    Array.from(new Set(allClassrooms.map(c => c.yearLevel).filter(Boolean))).sort()
  , [allClassrooms])

  const uniqueSubjectCodes = useMemo(() =>
    Array.from(new Set(allClassrooms.map(c => c.subjectCode).filter(Boolean))).sort()
  , [allClassrooms])

  const uniqueSemesters = useMemo(() =>
    Array.from(new Set(allClassrooms.map(c => c.semester).filter(Boolean))).sort()
  , [allClassrooms])

  const uniqueAcademicYears = useMemo(() =>
    Array.from(new Set(allClassrooms.map(c => c.academicYear).filter(Boolean))).sort().reverse()
  , [allClassrooms])

  // Sections that match the top-level dropdown filters (year level, subject, semester, AY)
  const filteredAvailableSections = useMemo(() => {
    const map = new Map<string, { id: string; sectionCode: string; yearLevel: string }>()
    allClassrooms.forEach(c => {
      if (filterYearLevel && c.yearLevel !== filterYearLevel) return
      if (filterSubjectCode && c.subjectCode !== filterSubjectCode) return
      if (filterSemester && c.semester !== filterSemester) return
      if (filterAcademicYear && c.academicYear !== filterAcademicYear) return
      if (!map.has(c.sectionId))
        map.set(c.sectionId, { id: c.sectionId, sectionCode: c.sectionCode, yearLevel: c.yearLevel })
    })
    return Array.from(map.values()).sort((a, b) => a.sectionCode.localeCompare(b.sectionCode))
  }, [allClassrooms, filterYearLevel, filterSubjectCode, filterSemester, filterAcademicYear])

  // Students filtered by search + status
  const filteredStudents = useMemo(() => {
    return loadedStudents.filter(s => {
      const matchesSearch = `${s.first_name} ${s.last_name} ${s.student_number} ${s.sectionCode}`
        .toLowerCase().includes(searchQuery.toLowerCase())
      const matchesStatus = !filterStatus || s.status === filterStatus
      return matchesSearch && matchesStatus
    })
  }, [loadedStudents, searchQuery, filterStatus])

  // Summary computed from ALL loaded students (unfiltered by search/status)
  const computedSummary = useMemo<OverallSummary>(() => ({
    present: loadedStudents.filter(s => s.status === 'present').length,
    late: loadedStudents.filter(s => s.status === 'late').length,
    absent: loadedStudents.filter(s => s.status === 'absent').length,
    total: loadedStudents.length,
  }), [loadedStudents])

  // Export tab: sections filtered by the export dropdowns
  const exportFilteredSections = useMemo(() => {
    const map = new Map<string, { id: string; sectionCode: string }>()
    allClassrooms.forEach(c => {
      if (exportSubjectCode && c.subjectCode !== exportSubjectCode) return
      if (exportSemester && c.semester !== exportSemester) return
      if (exportAcademicYear && c.academicYear !== exportAcademicYear) return
      if (!map.has(c.sectionId))
        map.set(c.sectionId, { id: c.sectionId, sectionCode: c.sectionCode })
    })
    return Array.from(map.values()).sort((a, b) => a.sectionCode.localeCompare(b.sectionCode))
  }, [allClassrooms, exportSubjectCode, exportSemester, exportAcademicYear])

  // Keep exportSectionIds valid when filters change
  useEffect(() => {
    setExportSectionIds(prev => {
      const valid = new Set(exportFilteredSections.map(s => s.id))
      return prev.filter(id => valid.has(id))
    })
  }, [exportFilteredSections])

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'professor' && (user.role as any) !== 'adviser'))) {
      router.push('/professor/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (!loading && user) {
      fetchSummary()
      fetchAllClassrooms()
    }
  }, [user, loading])

  // Auto-remove selectedSectionIds that no longer match filters
  useEffect(() => {
    setSelectedSectionIds(prev => {
      const validIds = new Set(filteredAvailableSections.map(s => s.id))
      return prev.filter(id => validIds.has(id))
    })
  }, [filteredAvailableSections])

  const fetchSummary = async () => {
    setLoadingSummary(true)
    try {
      const res = await fetch(`/api/professor/attendance/summary?professorId=${user?.id}`)
      const data = await res.json()
      if (data.success) {
        setSummary(data.summary)
        setSections(data.sections)
      }
    } catch (err) {
      console.error('Error fetching summary:', err)
    } finally {
      setLoadingSummary(false)
    }
  }

  const fetchAllClassrooms = async () => {
    try {
      const res = await fetch(`/api/professor/classrooms?professorId=${user?.id}`)
      const data = await res.json()
      if (data.classrooms) {
        const classrooms: AvailableClassroom[] = data.classrooms.map((c: any) => ({
          classSessionId: c.id,
          sectionId: c.section_id,
          sectionCode: c.sections?.section_code || c.section_id,
          subjectCode: c.subject_code || '',
          subjectName: c.subject_name || '',
          dayOfWeek: c.day_of_week || '',
          semester: c.sections?.semester || '',
          academicYear: c.sections?.academic_year || '',
          yearLevel: deriveYearLevelFromSectionCode(c.sections?.section_code || c.section_id),
        }))
        setAllClassrooms(classrooms)
      }
    } catch (err) {
      console.error('Error fetching classrooms:', err)
    }
  }

  const handleFetchAndExport = async () => {
    if (exportSectionIds.length === 0) return
    setExportLoading(true)
    setExportPreview(null)
    try {
      const params = new URLSearchParams({
        professorId: user!.id,
        sectionIds: exportSectionIds.join(','),
        dateFrom: exportDateFrom,
        dateTo: exportDateTo,
        ...(exportSubjectCode && { subjectCode: exportSubjectCode }),
        ...(exportSemester && { semester: exportSemester }),
        ...(exportAcademicYear && { academicYear: exportAcademicYear }),
        ...(exportStatus && { status: exportStatus }),
      })
      const res = await fetch(`/api/professor/attendance/export?${params}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setExportPreview({ rows: data.rows, total: data.total })
      if (data.total === 0) return
      const label = exportSectionIds.length === 1
        ? (exportFilteredSections.find(s => s.id === exportSectionIds[0])?.sectionCode ?? 'export')
        : `${exportSectionIds.length}_sections`

      const headers = [
        'Date',
        'Section',
        'Year Level',
        'Semester',
        'Academic Year',
        'Subject Code',
        'Subject Name',
        'Student No.',
        'Last Name',
        'First Name',
        'Status',
        'Time In',
        'Confidence',
      ]

      const rows = (data.rows || []).map((r: any) => ({
        'Date': r.date,
        'Section': r.sectionCode,
        'Year Level': r.yearLevel ? `${r.yearLevel}` : '',
        'Semester': r.semester,
        'Academic Year': r.academicYear,
        'Subject Code': r.subjectCode,
        'Subject Name': r.subjectName,
        'Student No.': r.studentNumber,
        'Last Name': r.lastName,
        'First Name': r.firstName,
        'Status': r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : '',
        'Time In': r.checkedInAt
          ? new Date(r.checkedInAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '—',
        'Confidence': r.faceMatchConfidence != null ? `${(r.faceMatchConfidence * 100).toFixed(1)}%` : '—',
      }))

      downloadCsv(
        `Attendance_${label}_${exportDateFrom}_to_${exportDateTo}.csv`,
        headers,
        rows,
      )
    } catch (err: any) {
      console.error('Export error:', err)
    } finally {
      setExportLoading(false)
    }
  }

  const exportDailyToExcel = () => {
    const selectedCodes = filteredAvailableSections
      .filter(s => selectedSectionIds.includes(s.id))
      .map(s => s.sectionCode)
      .join('_')
    const label = selectedCodes || 'Report'
    const wsData = [
      ['Section', 'Year Level', 'Subject Code', 'Date', 'Student No.', 'Last Name', 'First Name', 'Status', 'Time In', 'Confidence'],
      ...filteredStudents.map(s => {
        const subjectCodes = [...new Set(
          allClassrooms.filter(c => c.sectionCode === s.sectionCode).map(c => c.subjectCode).filter(Boolean)
        )].join(', ')
        const yl = allClassrooms.find(c => c.sectionCode === s.sectionCode)?.yearLevel || ''
        return [
          s.sectionCode,
          yl,
          subjectCodes,
          selectedDate,
          s.student_number,
          s.last_name,
          s.first_name,
          s.status.charAt(0).toUpperCase() + s.status.slice(1),
          formatTimeString(s.checked_in_at),
          s.face_match_confidence ? `${(s.face_match_confidence * 100).toFixed(1)}%` : '—',
        ]
      }),
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [14, 10, 14, 12, 14, 18, 18, 10, 12, 12].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    XLSX.writeFile(wb, `Attendance_${label}_${selectedDate}.xlsx`)
  }

  const exportSummaryToExcel = () => {
    const wsData = [
      ['Section', 'Present', 'Late', 'Absent', 'Total', 'Attendance Rate (%)'],
      ...sections.map(s => [
        s.section_code, s.present, s.late, s.absent, s.total,
        s.total > 0 ? (((s.present + s.late) / s.total) * 100).toFixed(1) : '0.0',
      ]),
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [20, 10, 10, 10, 10, 20].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Summary')
    XLSX.writeFile(wb, `Attendance_Summary_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const fetchAllSelectedSections = async () => {
    if (selectedSectionIds.length === 0 || !selectedDate) {
      setLoadedStudents([])
      return
    }
    setLoadingDaily(true)
    try {
      const results = await Promise.all(
        selectedSectionIds.map(sectionId =>
          fetch(`/api/professor/attendance/daily-detail?sectionId=${sectionId}&date=${selectedDate}`)
            .then(r => r.json())
        )
      )
      const merged: DailyStudent[] = []
      results.forEach((data, i) => {
        if (data.success) {
          const sectionCode = data.section?.section_code ||
            allClassrooms.find(c => c.sectionId === selectedSectionIds[i])?.sectionCode || ''
          data.students.forEach((s: any) => merged.push({ ...s, sectionCode }))
        }
      })
      merged.sort((a, b) =>
        a.sectionCode.localeCompare(b.sectionCode) || a.last_name.localeCompare(b.last_name)
      )
      setLoadedStudents(merged)
    } catch (err) {
      console.error('Error fetching attendance:', err)
    } finally {
      setLoadingDaily(false)
    }
  }

  useEffect(() => {
    if (activeView === 'daily') {
      fetchAllSelectedSections()
    }
  }, [activeView, selectedSectionIds, selectedDate])

  const navigateDate = (direction: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + direction)
    setSelectedDate(d.toISOString().split('T')[0])
  }



  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => router.push('/professor')} className="p-2 hover:bg-gray-100 rounded-lg transition">
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Attendance Reports</h1>
                <p className="text-sm text-gray-600">View attendance summary and daily details</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="flex gap-1 mb-8 bg-white rounded-xl p-1 shadow-sm border w-fit">
          <button
            onClick={() => setActiveView('summary')}
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeView === 'summary'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Summary
            </span>
          </button>
          <button
            onClick={() => setActiveView('daily')}
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeView === 'daily'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Daily Detail
            </span>
          </button>
          <button
            onClick={() => setActiveView('export')}
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeView === 'export'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center gap-2">
              <FileDown className="w-4 h-4" />
              Export
            </span>
          </button>
        </div>

        {/* SUMMARY VIEW */}
        {activeView === 'summary' && (
          <div className="space-y-6">
            {/* Overall Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Total Students</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">{summary.total}</p>
                  </div>
                  <div className="bg-blue-100 p-3 rounded-xl">
                    <Users className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Present Today</p>
                    <p className="text-3xl font-bold text-green-600 mt-1">{summary.present}</p>
                  </div>
                  <div className="bg-green-100 p-3 rounded-xl">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Late Today</p>
                    <p className="text-3xl font-bold text-yellow-600 mt-1">{summary.late}</p>
                  </div>
                  <div className="bg-yellow-100 p-3 rounded-xl">
                    <Clock className="w-6 h-6 text-yellow-600" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Absent Today</p>
                    <p className="text-3xl font-bold text-red-600 mt-1">{summary.absent}</p>
                  </div>
                  <div className="bg-red-100 p-3 rounded-xl">
                    <XCircle className="w-6 h-6 text-red-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* Attendance Rate */}
            {summary.total > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Overall Attendance Rate</h3>
                  <span className="text-2xl font-bold text-emerald-600">
                    {((summary.present + summary.late) / summary.total * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full flex">
                    <div
                      className="bg-green-500 h-full"
                      style={{ width: `${(summary.present / summary.total * 100)}%` }}
                    />
                    <div
                      className="bg-yellow-500 h-full"
                      style={{ width: `${(summary.late / summary.total * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-6 mt-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> Present</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500" /> Late</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200" /> Absent</span>
                </div>
              </div>
            )}

            {/* Per Section Breakdown */}
            <div className="bg-white rounded-xl shadow-sm border">
              <div className="p-6 border-b flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">Section Breakdown</h3>
                  <p className="text-sm text-gray-500 mt-1">Today&apos;s attendance by section</p>
                </div>
                {sections.length > 0 && (
                  <button
                    onClick={exportSummaryToExcel}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition"
                  >
                    <Download className="w-4 h-4" />
                    Export Excel
                  </button>
                )}
              </div>
              {loadingSummary ? (
                <div className="p-12 text-center">
                  <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : sections.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No sections found</p>
                </div>
              ) : (
                <div className="divide-y">
                  {sections.map((section) => (
                    <div key={section.id} className="p-4 hover:bg-gray-50 transition flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="bg-emerald-100 p-2.5 rounded-lg">
                          <Users className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{section.section_code}</p>
                          <p className="text-sm text-gray-500">{section.total} students</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-center">
                          <p className="text-lg font-bold text-green-600">{section.present}</p>
                          <p className="text-xs text-gray-500">Present</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-yellow-600">{section.late}</p>
                          <p className="text-xs text-gray-500">Late</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-red-600">{section.absent}</p>
                          <p className="text-xs text-gray-500">Absent</p>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedSectionIds([section.id])
                            setSelectedDate(new Date().toISOString().split('T')[0])
                            setActiveView('daily')
                          }}
                          className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                          title="View daily detail"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* DAILY DETAIL VIEW */}
        {activeView === 'daily' && (
          <div className="space-y-6">

            {/* ── Filter Panel ─────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Filters</h3>
              </div>

              {/* Row 1: Dropdowns */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* Year Level */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Year Level</label>
                  <select value={filterYearLevel} onChange={e => setFilterYearLevel(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                    <option value="">All Levels</option>
                    {uniqueYearLevels.map(y => <option key={y} value={y}>{y} Year</option>)}
                  </select>
                </div>
                {/* Subject Code */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subject Code</label>
                  <select value={filterSubjectCode} onChange={e => setFilterSubjectCode(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                    <option value="">All Subjects</option>
                    {uniqueSubjectCodes.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {/* Semester */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Semester</label>
                  <select value={filterSemester} onChange={e => setFilterSemester(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                    <option value="">All Semesters</option>
                    {uniqueSemesters.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {/* Academic Year */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Academic Year</label>
                  <select value={filterAcademicYear} onChange={e => setFilterAcademicYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                    <option value="">All Years</option>
                    {uniqueAcademicYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                {/* Status */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Attendance Status</label>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                    <option value="">All Statuses</option>
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Section checkboxes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">
                    Sections
                    {selectedSectionIds.length > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">
                        {selectedSectionIds.length} selected
                      </span>
                    )}
                  </label>
                  <div className="flex gap-3 text-xs">
                    <button
                      onClick={() => setSelectedSectionIds(filteredAvailableSections.map(s => s.id))}
                      className="text-emerald-600 hover:text-emerald-700 font-medium"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedSectionIds([])}
                      className="text-gray-500 hover:text-gray-700 font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {filteredAvailableSections.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No sections match the filters above.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {filteredAvailableSections.map(sec => {
                      const checked = selectedSectionIds.includes(sec.id)
                      return (
                        <label
                          key={sec.id}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition select-none ${
                            checked
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-800 font-medium'
                              : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedSectionIds(prev =>
                                checked ? prev.filter(id => id !== sec.id) : [...prev, sec.id]
                              )
                            }
                            className="accent-emerald-600 w-3.5 h-3.5"
                          />
                          {sec.sectionCode}
                          {sec.yearLevel && (
                            <span className="text-xs text-gray-400">Yr {sec.yearLevel}</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Row 3: Date + Search */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => navigateDate(-1)} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={e => setSelectedDate(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button onClick={() => navigateDate(1)} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Search Student</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Name, student number, or section…"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Stats ────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <p className="text-sm font-medium text-gray-500">Showing</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{filteredStudents.length}</p>
                <p className="text-xs text-gray-400 mt-0.5">of {computedSummary.total}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <p className="text-sm font-medium text-gray-500">Present</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{computedSummary.present}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <p className="text-sm font-medium text-gray-500">Late</p>
                <p className="text-2xl font-bold text-yellow-600 mt-1">{computedSummary.late}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <p className="text-sm font-medium text-gray-500">Absent</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{computedSummary.absent}</p>
              </div>
            </div>

            {/* ── Heading + Export ─────────────────────────────────────── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedSectionIds.length === 0
                    ? 'No sections selected'
                    : selectedSectionIds.length === 1
                    ? filteredAvailableSections.find(s => s.id === selectedSectionIds[0])?.sectionCode || '1 section'
                    : `${selectedSectionIds.length} sections`}
                  {' — '}
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </h3>
                {selectedSectionIds.length > 1 && (
                  <p className="text-sm text-gray-500 mt-0.5">
                    {filteredAvailableSections
                      .filter(s => selectedSectionIds.includes(s.id))
                      .map(s => s.sectionCode)
                      .join(', ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                  className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  Today
                </button>
                {filteredStudents.length > 0 && (
                  <button
                    onClick={exportDailyToExcel}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition"
                  >
                    <Download className="w-4 h-4" />
                    Export Excel
                  </button>
                )}
              </div>
            </div>

            {/* ── Student Table ─────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {loadingDaily ? (
                <div className="p-12 text-center">
                  <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : selectedSectionIds.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <Filter className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">Select at least one section above</p>
                  <p className="text-sm mt-1">Use the filters to narrow down sections, then check the ones you want.</p>
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No students found for this selection</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Section</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student No.</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Time In</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredStudents.map((student, idx) => (
                        <tr key={`${student.id}-${student.sectionCode}`} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-4 text-sm text-gray-500">{idx + 1}</td>
                          <td className="px-4 py-4">
                            <span className="inline-block px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-md border border-emerald-200">
                              {student.sectionCode}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                student.status === 'present' ? 'bg-green-100 text-green-700' :
                                student.status === 'late' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-500'
                              }`}>
                                {student.first_name[0]}{student.last_name[0]}
                              </div>
                              <p className="text-sm font-medium text-gray-900">
                                {student.last_name}, {student.first_name}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-600">{student.student_number}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                              student.status === 'present' ? 'bg-green-100 text-green-800' :
                              student.status === 'late' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {student.status === 'present' && <CheckCircle className="w-3 h-3" />}
                              {student.status === 'late' && <Clock className="w-3 h-3" />}
                              {student.status === 'absent' && <XCircle className="w-3 h-3" />}
                              {student.status.charAt(0).toUpperCase() + student.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-600">{formatTimeString(student.checked_in_at)}</td>
                          <td className="px-4 py-4 text-sm text-gray-600">
                            {student.face_match_confidence
                              ? `${(student.face_match_confidence * 100).toFixed(1)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* EXPORT VIEW */}
        {activeView === 'export' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Export Attendance</h2>

              {/* Filter row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Subject Code</label>
                  <select
                    value={exportSubjectCode}
                    onChange={e => setExportSubjectCode(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">All Subjects</option>
                    {uniqueSubjectCodes.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Semester</label>
                  <select
                    value={exportSemester}
                    onChange={e => setExportSemester(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">All Semesters</option>
                    {uniqueSemesters.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
                  <select
                    value={exportAcademicYear}
                    onChange={e => setExportAcademicYear(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">All Years</option>
                    {uniqueAcademicYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              {/* Section checkboxes */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-gray-500">Sections</label>
                  <div className="flex gap-3 text-xs">
                    <button
                      onClick={() => setExportSectionIds(exportFilteredSections.map(s => s.id))}
                      className="text-emerald-600 hover:underline"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setExportSectionIds([])}
                      className="text-gray-500 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {exportFilteredSections.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No sections match the filters above.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {exportFilteredSections.map(sec => (
                      <label
                        key={sec.id}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                          exportSectionIds.includes(sec.id)
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-emerald-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={exportSectionIds.includes(sec.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setExportSectionIds(prev => [...prev, sec.id])
                            } else {
                              setExportSectionIds(prev => prev.filter(id => id !== sec.id))
                            }
                          }}
                          className="accent-emerald-600"
                        />
                        {sec.sectionCode}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Date range + status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
                  <input
                    type="date"
                    value={exportDateFrom}
                    onChange={e => setExportDateFrom(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
                  <input
                    type="date"
                    value={exportDateTo}
                    onChange={e => setExportDateTo(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                  <select
                    value={exportStatus}
                    onChange={e => setExportStatus(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">All Statuses</option>
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
              </div>

              {/* Action row */}
              <div className="flex items-center gap-4">
                <button
                  onClick={handleFetchAndExport}
                  disabled={exportLoading || exportSectionIds.length === 0}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {exportLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4" />
                  )}
                  {exportLoading ? 'Exporting…' : 'Fetch & Export CSV'}
                </button>
                {exportSectionIds.length === 0 && (
                  <p className="text-xs text-amber-600">Select at least one section to export.</p>
                )}
              </div>

              {/* Preview info */}
              {exportPreview !== null && !exportLoading && (
                <div className={`mt-4 px-4 py-3 rounded-lg text-sm ${
                  exportPreview.total === 0
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }`}>
                  {exportPreview.total === 0
                    ? 'No attendance records found for the selected filters. No file was downloaded.'
                    : `✓ Exported ${exportPreview.total} record${exportPreview.total !== 1 ? 's' : ''} across ${exportSectionIds.length} section${exportSectionIds.length !== 1 ? 's' : ''}.`}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}