'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Download, Filter, Calendar, Users, TrendingUp, TrendingDown } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface AttendanceStats {
  totalRecords: number
  presentCount: number
  absentCount: number
  lateCount: number
  attendanceRate: number
}

interface SectionReport {
  section_name: string
  course_code: string
  professor_name: string
  total_students: number
  attendance_rate: number
}

export default function ReportsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const supabase = createClient()

  const [stats, setStats] = useState<AttendanceStats>({
    totalRecords: 0,
    presentCount: 0,
    absentCount: 0,
    lateCount: 0,
    attendanceRate: 0,
  })
  const [sectionReports, setSectionReports] = useState<SectionReport[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      fetchReports()
    }
  }, [user, dateFrom, dateTo])

  const fetchReports = async () => {
    setLoadingData(true)
    try {
      // Fetch overall attendance stats
      let query = supabase
        .from('attendance_records')
        .select('status')

      if (dateFrom) {
        query = query.gte('date', dateFrom)
      }
      if (dateTo) {
        query = query.lte('date', dateTo)
      }

      const { data: attendanceData } = await query

      if (attendanceData) {
        const presentCount = attendanceData.filter(r => r.status === 'present').length
        const absentCount = attendanceData.filter(r => r.status === 'absent').length
        const lateCount = attendanceData.filter(r => r.status === 'late').length
        const totalRecords = attendanceData.length

        setStats({
          totalRecords,
          presentCount,
          absentCount,
          lateCount,
          attendanceRate: totalRecords > 0 ? (presentCount / totalRecords) * 100 : 0,
        })
      }

      // Fetch section-wise reports
      const { data: sections } = await supabase
        .from('sections')
        .select(`
          id,
          section_name,
          courses (course_code),
          users!professor_id (first_name, last_name),
          enrollments (count)
        `)

      if (sections) {
        const reports: SectionReport[] = []
        
        for (const section of sections) {
          const { data: sectionAttendance } = await supabase
            .from('attendance_records')
            .select('status')
            .eq('section_id', section.id)

          const totalRecords = sectionAttendance?.length || 0
          const presentCount = sectionAttendance?.filter(r => r.status === 'present').length || 0

          reports.push({
            section_name: section.section_name,
            course_code: (section.courses as any)?.course_code || 'N/A',
            professor_name: section.users 
              ? `${(section.users as any).first_name} ${(section.users as any).last_name}`
              : 'Unassigned',
            total_students: Array.isArray(section.enrollments) ? section.enrollments.length : 0,
            attendance_rate: totalRecords > 0 ? (presentCount / totalRecords) * 100 : 0,
          })
        }

        setSectionReports(reports)
      }
    } catch (error) {
      console.error('Error fetching reports:', error)
    } finally {
      setLoadingData(false)
    }
  }

  const exportToCSV = () => {
    const csvContent = [
      ['Section', 'Course', 'Professor', 'Total Students', 'Attendance Rate'],
      ...sectionReports.map(r => [
        r.section_name,
        r.course_code,
        r.professor_name,
        r.total_students.toString(),
        `${r.attendance_rate.toFixed(1)}%`,
      ]),
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading reports...</p>
        </div>
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
              <button
                onClick={() => router.push('/admin')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Attendance Reports</h1>
                <p className="text-sm text-gray-600 mt-1">View and export attendance analytics</p>
              </div>
            </div>
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Records</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{stats.totalRecords}</p>
              </div>
              <Calendar className="w-8 h-8 text-blue-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Present</p>
                <p className="text-3xl font-bold text-green-600 mt-2">{stats.presentCount}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Absent</p>
                <p className="text-3xl font-bold text-red-600 mt-2">{stats.absentCount}</p>
              </div>
              <TrendingDown className="w-8 h-8 text-red-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Attendance Rate</p>
                <p className="text-3xl font-bold text-violet-600 mt-2">{stats.attendanceRate.toFixed(1)}%</p>
              </div>
              <Users className="w-8 h-8 text-violet-500" />
            </div>
          </div>
        </div>

        {/* Section Reports */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Section-wise Attendance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Section
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Course
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Professor
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Students
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Attendance Rate
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sectionReports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No data available
                    </td>
                  </tr>
                ) : (
                  sectionReports.map((report, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{report.section_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                        {report.course_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                        {report.professor_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                        {report.total_students}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[100px]">
                            <div
                              className={`h-2 rounded-full ${
                                report.attendance_rate >= 80
                                  ? 'bg-green-500'
                                  : report.attendance_rate >= 60
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${report.attendance_rate}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium text-gray-900">
                            {report.attendance_rate.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
