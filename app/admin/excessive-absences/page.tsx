'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Mail,
  RefreshCw,
  ShieldAlert,
  Users,
  Clock,
  BarChart3,
} from 'lucide-react'

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

const EMPTY_SUMMARY: MonitorSummary = {
  totalTrackedStudents: 0,
  totalAbsences: 0,
  flaggedStudents: 0,
  habitualStudents: 0,
  watchlistStudents: 0,
  emailableFlaggedStudents: 0,
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function riskLabel(level: RiskLevel): string {
  if (level === 'habitual') return 'Habitual'
  if (level === 'excessive') return 'Excessive'
  if (level === 'watch') return 'Watch'
  return 'Normal'
}

function riskStyles(level: RiskLevel): string {
  if (level === 'habitual') return 'bg-red-100 text-red-800'
  if (level === 'excessive') return 'bg-orange-100 text-orange-800'
  if (level === 'watch') return 'bg-yellow-100 text-yellow-800'
  return 'bg-gray-100 text-gray-700'
}

function normalizeFilterDateLabel(dateFrom: string, dateTo: string): string {
  if (!dateFrom && !dateTo) return 'All recorded dates'

  const fromLabel = dateFrom || 'earliest record'
  const toLabel = dateTo || 'latest record'
  return `${fromLabel} to ${toLabel}`
}

function buildStudentWarningSubject(student: MonitorStudent): string {
  return `Attendance Warning: ${student.absentCount} total absences`
}

function buildStudentWarningBody(student: MonitorStudent, threshold: number, dateFrom: string, dateTo: string): string {
  const sectionLabel = student.sectionCodes.length > 0 ? student.sectionCodes.join(', ') : 'N/A'
  const dateRangeLabel = normalizeFilterDateLabel(dateFrom, dateTo)

  return [
    `Good day ${student.fullName},`,
    '',
    'This is an attendance warning from the Attendance Monitoring Office.',
    `Our records show that you have ${student.absentCount} total absences, which meets or exceeds the threshold of ${threshold}.`,
    '',
    `Student Number: ${student.studentNumber}`,
    `Section(s): ${sectionLabel}`,
    `Late Count: ${student.lateCount}`,
    `Covered Date Range: ${dateRangeLabel}`,
    '',
    'Please coordinate with your professor or guidance office as soon as possible to discuss your attendance status.',
    '',
    'Regards,',
    'Attendance Monitoring Office',
  ].join('\n')
}

function buildBulkWarningBody(students: MonitorStudent[], threshold: number, dateFrom: string, dateTo: string): string {
  const dateRangeLabel = normalizeFilterDateLabel(dateFrom, dateTo)
  const studentList = students
    .map((student, index) => `${index + 1}. ${student.fullName} (${student.studentNumber}) - ${student.absentCount} absences`)
    .join('\n')

  return [
    'Good day students,',
    '',
    'This is a consolidated attendance warning from the Attendance Monitoring Office.',
    `You are receiving this notice because your recorded absences meet or exceed the threshold of ${threshold}.`,
    `Covered Date Range: ${dateRangeLabel}`,
    '',
    'Flagged Students:',
    studentList,
    '',
    'Please contact your professor or the guidance office to address your attendance status.',
    '',
    'Regards,',
    'Attendance Monitoring Office',
  ].join('\n')
}

function openGmailDraft(options: { to: string; subject: string; body: string; bcc?: string[] }) {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    tf: '1',
    to: options.to,
    su: options.subject,
    body: options.body,
  })

  if (options.bcc && options.bcc.length > 0) {
    params.set('bcc', options.bcc.join(','))
  }

  const gmailComposeUrl = `https://mail.google.com/mail/?${params.toString()}`
  window.open(gmailComposeUrl, '_blank', 'noopener,noreferrer')
}

export default function ExcessiveAbsencesPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [threshold, setThreshold] = useState(3)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [students, setStudents] = useState<MonitorStudent[]>([])
  const [summary, setSummary] = useState<MonitorSummary>(EMPTY_SUMMARY)
  const [loadingData, setLoadingData] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sendingStudentId, setSendingStudentId] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)

  const [errorMessage, setErrorMessage] = useState<string>('')
  const [successMessage, setSuccessMessage] = useState<string>('')

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [loading, user, router])

  const loadMonitorData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true)
    setLoadingData(true)
    setErrorMessage('')

    try {
      const params = new URLSearchParams({ threshold: String(threshold) })
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)

      const response = await fetch(`/api/admin/excessive-absences?${params.toString()}`)
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load monitor data')
      }

      setStudents((payload.students || []) as MonitorStudent[])
      setSummary((payload.summary || EMPTY_SUMMARY) as MonitorSummary)
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, 'Failed to load excessive absence data'))
      setStudents([])
      setSummary(EMPTY_SUMMARY)
    } finally {
      setLoadingData(false)
      if (showRefreshing) setRefreshing(false)
    }
  }, [dateFrom, dateTo, threshold])

  useEffect(() => {
    if (user?.id) {
      void loadMonitorData(false)
    }
  }, [user?.id, loadMonitorData])

  const handleSendWarning = (student: MonitorStudent) => {
    if (!student.meetsThreshold) {
      setErrorMessage('This student is below the configured absence threshold.')
      return
    }

    if (!student.email) {
      setErrorMessage('Student has no email on file.')
      return
    }

    setSendingStudentId(student.studentId || student.studentNumber)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      openGmailDraft({
        to: student.email,
        subject: buildStudentWarningSubject(student),
        body: buildStudentWarningBody(student, threshold, dateFrom, dateTo),
      })
      setSuccessMessage(`Opened Gmail draft for ${student.fullName} (${student.email})`)
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, 'Failed to open Gmail draft'))
    } finally {
      setSendingStudentId(null)
    }
  }

  const handleSendAllWarnings = () => {
    const candidates = students.filter((student) => student.meetsThreshold && !!student.email)

    if (candidates.length === 0) {
      setErrorMessage('No emailable students meet the threshold right now.')
      return
    }

    setSendingAll(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const to = candidates[0].email as string
      const bcc = candidates.slice(1).map((student) => student.email as string)

      openGmailDraft({
        to,
        bcc,
        subject: `Attendance Warning Notices (${candidates.length} students)`,
        body: buildBulkWarningBody(candidates, threshold, dateFrom, dateTo),
      })

      setSuccessMessage(`Opened one Gmail draft for ${candidates.length} warning recipient(s).`)
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, 'Failed to open Gmail draft'))
    } finally {
      setSendingAll(false)
    }
  }

  const flaggedStudents = useMemo(
    () => students.filter((student) => student.meetsThreshold),
    [students]
  )

  if (loading || loadingData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-gray-600">Loading absence monitor...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/admin')}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Excessive Absence Monitor</h1>
                <p className="text-sm text-gray-600">
                  Track habitual absences and send warning emails when a student reaches {threshold}+ absences.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadMonitorData(true)}
                disabled={refreshing || sendingAll}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleSendAllWarnings}
                disabled={sendingAll || flaggedStudents.length === 0 || summary.emailableFlaggedStudents === 0}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                {sendingAll ? 'Opening...' : 'Open Gmail Draft (All)'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
            {successMessage}
          </div>
        )}

        <section className="bg-white rounded-lg shadow p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Absence Threshold</label>
              <input
                type="number"
                min={1}
                max={20}
                value={threshold}
                onChange={(event) => {
                  const nextValue = Number(event.target.value)
                  if (Number.isFinite(nextValue) && nextValue >= 1) {
                    setThreshold(Math.floor(nextValue))
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-gray-500 mt-1">Default warning threshold is 3 absences.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Tracked Students</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{summary.totalTrackedStudents}</p>
              </div>
              <Users className="w-6 h-6 text-blue-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Absences</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{summary.totalAbsences}</p>
              </div>
              <BarChart3 className="w-6 h-6 text-red-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Excessive / Threshold</p>
                <p className="text-2xl font-bold text-orange-600 mt-1">{summary.flaggedStudents}</p>
              </div>
              <AlertTriangle className="w-6 h-6 text-orange-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Habitual Cases</p>
                <p className="text-2xl font-bold text-rose-600 mt-1">{summary.habitualStudents}</p>
              </div>
              <ShieldAlert className="w-6 h-6 text-rose-500" />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Students with Absence Records</h2>
              <p className="text-sm text-gray-600">
                Warning actions open Gmail compose drafts for students at or above the threshold with a valid email.
              </p>
            </div>
            <div className="text-sm text-gray-700">
              <span className="font-medium">Watchlist:</span> {summary.watchlistStudents} •
              <span className="font-medium ml-2">Emailable flagged:</span> {summary.emailableFlaggedStudents}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student Number</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sections</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Absent</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Late</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Absent</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                      No absence data found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  students.map((student) => {
                    const isSending = sendingStudentId === (student.studentId || student.studentNumber)

                    return (
                      <tr key={student.studentNumber} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{student.fullName}</div>
                          <div className="text-xs text-gray-500">{student.email || 'No email'}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">{student.studentNumber}</td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {student.sectionCodes.length > 0 ? student.sectionCodes.join(', ') : 'N/A'}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                            {student.absentCount}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                            {student.lateCount}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {student.lastAbsentAt ? new Date(student.lastAbsentAt).toLocaleString() : 'N/A'}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${riskStyles(student.riskLevel)}`}>
                            {riskLabel(student.riskLevel)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleSendWarning(student)}
                            disabled={
                              isSending ||
                              sendingAll ||
                              !student.meetsThreshold ||
                              !student.email
                            }
                            className="px-3 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            title={
                              !student.meetsThreshold
                                ? `Below threshold (${threshold})`
                                : !student.email
                                ? 'Student has no email'
                                : 'Open Gmail warning draft'
                            }
                          >
                            {isSending ? <Clock className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                            {isSending ? 'Opening...' : 'Open Draft'}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
