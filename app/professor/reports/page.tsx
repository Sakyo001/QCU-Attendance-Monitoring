'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, BarChart3, Calendar, Users, CheckCircle, Clock, XCircle, ChevronDown, Search, Download, ChevronLeft, ChevronRight, Eye } from 'lucide-react'

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

export default function ProfessorReportsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [activeView, setActiveView] = useState<'summary' | 'daily'>('summary')
  const [sections, setSections] = useState<SectionSummary[]>([])
  const [summary, setSummary] = useState<OverallSummary>({ present: 0, late: 0, absent: 0, total: 0 })
  const [loadingSummary, setLoadingSummary] = useState(true)

  // Daily detail state
  const [selectedSection, setSelectedSection] = useState<string>('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [dailyStudents, setDailyStudents] = useState<DailyStudent[]>([])
  const [dailySummary, setDailySummary] = useState<OverallSummary>({ present: 0, late: 0, absent: 0, total: 0 })
  const [dailySectionInfo, setDailySectionInfo] = useState<any>(null)
  const [loadingDaily, setLoadingDaily] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Available sections for the professor
  const [availableSections, setAvailableSections] = useState<{ id: string; section_code: string }[]>([])

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'professor' && (user.role as any) !== 'adviser'))) {
      router.push('/professor/login')
      return
    }
    if (!loading && user) {
      fetchSummary()
      fetchAvailableSections()
    }
  }, [user, loading, router])

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

  const fetchAvailableSections = async () => {
    try {
      const res = await fetch(`/api/professor/classrooms?professorId=${user?.id}`)
      const data = await res.json()
      if (data.classrooms) {
        const secs = data.classrooms.map((c: any) => ({
          id: c.section_id,
          section_code: c.sections?.section_code || c.section_id
        }))
        // Deduplicate
        const unique = Array.from(new Map(secs.map((s: any) => [s.id, s])).values()) as { id: string; section_code: string }[]
        setAvailableSections(unique)
        if (unique.length > 0 && !selectedSection) {
          setSelectedSection(unique[0].id)
        }
      }
    } catch (err) {
      console.error('Error fetching sections:', err)
    }
  }

  const fetchDailyDetail = async () => {
    if (!selectedSection || !selectedDate) return
    setLoadingDaily(true)
    try {
      const res = await fetch(`/api/professor/attendance/daily-detail?sectionId=${selectedSection}&date=${selectedDate}`)
      const data = await res.json()
      if (data.success) {
        setDailyStudents(data.students)
        setDailySummary(data.summary)
        setDailySectionInfo(data.section)
      }
    } catch (err) {
      console.error('Error fetching daily detail:', err)
    } finally {
      setLoadingDaily(false)
    }
  }

  useEffect(() => {
    if (activeView === 'daily' && selectedSection && selectedDate) {
      fetchDailyDetail()
    }
  }, [activeView, selectedSection, selectedDate])

  const navigateDate = (direction: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + direction)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const filteredStudents = dailyStudents.filter(s =>
    `${s.first_name} ${s.last_name} ${s.student_number}`.toLowerCase().includes(searchQuery.toLowerCase())
  )

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
              <div className="p-6 border-b">
                <h3 className="font-semibold text-gray-900">Section Breakdown</h3>
                <p className="text-sm text-gray-500 mt-1">Today&apos;s attendance by section</p>
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
                          <p className="font-semibold text-gray-900">BSIT {section.section_code}</p>
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
                            setSelectedSection(section.id)
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
            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                {/* Section Select */}
                <div className="flex-1 w-full md:w-auto">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                  <select
                    value={selectedSection}
                    onChange={(e) => setSelectedSection(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    {availableSections.map(sec => (
                      <option key={sec.id} value={sec.id}>BSIT {sec.section_code}</option>
                    ))}
                  </select>
                </div>

                {/* Date Picker */}
                <div className="flex-1 w-full md:w-auto">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigateDate(-1)}
                      className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      onClick={() => navigateDate(1)}
                      className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Search */}
                <div className="flex-1 w-full md:w-auto">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search student..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Daily Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <p className="text-sm font-medium text-gray-500">Total</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{dailySummary.total}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <p className="text-sm font-medium text-gray-500">Present</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{dailySummary.present}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <p className="text-sm font-medium text-gray-500">Late</p>
                <p className="text-2xl font-bold text-yellow-600 mt-1">{dailySummary.late}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <p className="text-sm font-medium text-gray-500">Absent</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{dailySummary.absent}</p>
              </div>
            </div>

            {/* Date heading */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {dailySectionInfo ? `BSIT ${dailySectionInfo.section_code}` : 'Section'} —{' '}
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </h3>
              <button
                onClick={() => {
                  setSelectedDate(new Date().toISOString().split('T')[0])
                }}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                Go to today
              </button>
            </div>

            {/* Student List */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {loadingDaily ? (
                <div className="p-12 text-center">
                  <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No students found for this date</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student ID</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Time In</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredStudents.map((student, idx) => (
                      <tr key={student.id} className="hover:bg-gray-50 transition">
                        <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                              student.status === 'present' ? 'bg-green-100 text-green-700' :
                              student.status === 'late' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {student.first_name[0]}{student.last_name[0]}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{student.first_name} {student.last_name}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{student.student_number}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                            student.status === 'present'
                              ? 'bg-green-100 text-green-800'
                              : student.status === 'late'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {student.status === 'present' && <CheckCircle className="w-3 h-3" />}
                            {student.status === 'late' && <Clock className="w-3 h-3" />}
                            {student.status === 'absent' && <XCircle className="w-3 h-3" />}
                            {student.status.charAt(0).toUpperCase() + student.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {student.checked_in_at
                            ? new Date(student.checked_in_at).toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                              })
                            : '—'
                          }
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {student.face_match_confidence
                            ? `${(student.face_match_confidence * 100).toFixed(1)}%`
                            : '—'
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
