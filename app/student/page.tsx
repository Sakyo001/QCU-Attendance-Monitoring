'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Calendar, BookOpen, CheckCircle, XCircle, LogOut, Users, GraduationCap, ChevronLeft, ChevronRight } from 'lucide-react'

interface Section {
  id: string
  section_code: string
  semester: string
  academic_year: string
  professor_name: string
}

interface Classmate {
  first_name: string
  last_name: string
  student_number: string
  registered_at: string
  attendance_stats: {
    total_days: number
    present_days: number
    absent_days: number
    attendance_rate: number
  }
}

interface AttendanceRecord {
  id: string
  date: string
  status: string
  section_code: string
  semester: string
  academic_year: string
}

interface AttendanceStats {
  total_days: number
  present_days: number
  absent_days: number
  attendance_rate: number
}

function AttendanceCalendar({ records }: { records: AttendanceRecord[] }) {
  const [currentDate, setCurrentDate] = useState(new Date())

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  const getRecordForDay = (day: number) => {
    const dateStr = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
      .toISOString()
      .split('T')[0]
    return records.find(r => r.date.split('T')[0] === dateStr)
  }

  const daysInMonth = getDaysInMonth(currentDate)
  const firstDay = getFirstDayOfMonth(currentDate)
  const days = []

  for (let i = 0; i < firstDay; i++) {
    days.push(null)
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i)
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))
  }

  const today = new Date()
  const isCurrentMonth = today.getMonth() === currentDate.getMonth() && 
                         today.getFullYear() === currentDate.getFullYear()

  return (
    <div className="mt-8 bg-white rounded-lg shadow">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-purple-100 p-2 rounded-lg">
              <Calendar className="w-6 h-6 text-purple-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Attendance Calendar</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 bg-green-500 rounded"></span> Present
            </span>
            <span className="inline-flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 bg-red-500 rounded"></span> Absent
            </span>
            <span className="inline-flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 bg-gray-200 rounded"></span> No Class
            </span>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="flex justify-center">
          <div className="w-full max-w-3xl">
            {/* Month/Year Header with Navigation */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">
                {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={previousMonth}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Previous month"
                >
                  <ChevronLeft className="w-5 h-5 text-gray-600" />
                </button>
                <button
                  onClick={() => setCurrentDate(new Date())}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Today
                </button>
                <button
                  onClick={nextMonth}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Next month"
                >
                  <ChevronRight className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-4 mb-6 pb-6 border-b border-gray-200">
              <span className="inline-flex items-center gap-2 text-sm text-gray-600">
                <span className="w-3 h-3 bg-green-500 rounded"></span> Present
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-gray-600">
                <span className="w-3 h-3 bg-red-500 rounded"></span> Absent
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-gray-600">
                <span className="w-3 h-3 bg-gray-200 rounded border border-gray-300"></span> No Class
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-gray-600">
                <span className="w-6 h-6 border-2 border-blue-500 rounded"></span> Today
              </span>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="text-center font-semibold text-gray-600 text-sm py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1 mb-6">
              {days.map((day, index) => {
                const record = day ? getRecordForDay(day) : null
                const isToday = isCurrentMonth && day === today.getDate()

                return (
                  <div
                    key={index}
                    className={`aspect-square flex items-center justify-center rounded-lg text-sm font-medium transition-all ${
                      day === null
                        ? ''
                        : record
                        ? record.status === 'present'
                          ? 'bg-green-100 text-green-900 border-2 border-green-500 cursor-pointer hover:bg-green-200'
                          : 'bg-red-100 text-red-900 border-2 border-red-500 cursor-pointer hover:bg-red-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 cursor-default'
                    } ${isToday ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
                    title={
                      day && record
                        ? `${day} ${monthNames[currentDate.getMonth()]} - ${record.status} at ${new Date(record.date).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`
                        : day
                        ? `${day} ${monthNames[currentDate.getMonth()]} - No class`
                        : ''
                    }
                  >
                    {day && (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <span>{day}</span>
                        {record && (
                          <div className="absolute bottom-1 right-1">
                            {record.status === 'present' ? (
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-600" />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Monthly Summary */}
            {records.length > 0 && (
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-3">Monthly Summary</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Classes Attended</p>
                    <p className="text-lg font-semibold text-green-600">
                      {records.filter(r => r.status === 'present' && r.date.split('T')[0].startsWith(currentDate.getFullYear() + '-' + String(currentDate.getMonth() + 1).padStart(2, '0'))).length}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Classes Missed</p>
                    <p className="text-lg font-semibold text-red-600">
                      {records.filter(r => r.status === 'absent' && r.date.split('T')[0].startsWith(currentDate.getFullYear() + '-' + String(currentDate.getMonth() + 1).padStart(2, '0'))).length}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Total Classes</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {records.filter(r => r.date.split('T')[0].startsWith(currentDate.getFullYear() + '-' + String(currentDate.getMonth() + 1).padStart(2, '0'))).length}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StudentDashboard() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const [isRegistered, setIsRegistered] = useState(false)
  const [checkingRegistration, setCheckingRegistration] = useState(true)
  const [section, setSection] = useState<Section | null>(null)
  const [classmates, setClassmates] = useState<Classmate[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStats>({
    total_days: 0,
    present_days: 0,
    absent_days: 0,
    attendance_rate: 0
  })
  const [loadingData, setLoadingData] = useState(true)
  const [classmatePage, setClassmatePage] = useState(0)
  const CLASSMATES_PER_PAGE = 3

  useEffect(() => {
    if (!loading && (!user || user.role !== 'student')) {
      router.push('/student/login')
      return
    }

    if (!loading && user) {
      checkFaceRegistration()
    }
  }, [user, loading, router])

  const checkFaceRegistration = async () => {
    try {
      setCheckingRegistration(true)
      const response = await fetch(`/api/student/face-registration/check?studentId=${user?.id}`)
      
      if (!response.ok) {
        console.error('Face registration check failed:', response.status)
        setIsRegistered(false)
        await loadStudentData()
        return
      }

      const data = await response.json()

      if (data.success) {
        setIsRegistered(data.isRegistered)
        await loadStudentData()
      }
    } catch (error) {
      console.error('Error checking face registration:', error)
      setIsRegistered(false)
      await loadStudentData()
    } finally {
      setCheckingRegistration(false)
    }
  }

  const loadStudentData = async () => {
    if (!user?.id) return

    try {
      setLoadingData(true)

      const sectionResponse = await fetch(`/api/student/section?studentId=${user.id}`)
      const sectionData = await sectionResponse.json()
      if (sectionData.success && sectionData.section) {
        setSection(sectionData.section)
      }

      const classmatesResponse = await fetch(`/api/student/classmates?studentId=${user.id}`)
      const classmatesData = await classmatesResponse.json()
      if (classmatesData.success) {
        setClassmates(classmatesData.classmates)
      }

      const recordsResponse = await fetch(`/api/student/attendance-records?studentId=${user.id}`)
      const recordsData = await recordsResponse.json()
      if (recordsData.success) {
        setAttendanceRecords(recordsData.records)
        setAttendanceStats(recordsData.stats)
      }
    } catch (error) {
      console.error('Error loading student data:', error)
    } finally {
      setLoadingData(false)
    }
  }

  if (loading || checkingRegistration) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/student/login')
  }

  const stats = [
    { label: 'Enrolled Section', value: section?.section_code || 'None', icon: BookOpen, color: 'bg-blue-500' },
    { label: 'Present Days', value: attendanceStats.present_days.toString(), icon: CheckCircle, color: 'bg-green-500' },
    { label: 'Absent Days', value: attendanceStats.absent_days.toString(), icon: XCircle, color: 'bg-red-500' },
    { label: 'Attendance Rate', value: `${attendanceStats.attendance_rate}%`, icon: Calendar, color: 'bg-purple-500' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Student Dashboard</h1>
              <p className="text-sm text-gray-600 mt-1">
                Welcome back, {user.firstName} {user.lastName}
              </p>
              <p className="text-sm text-gray-500">Student ID: {user.studentId}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isRegistered && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              ⚠️ <strong>Face Registration Required:</strong> You need to register your face before you can mark attendance. 
              <a href="/student/face-registration" className="ml-2 text-amber-900 font-semibold hover:underline">
                Register now →
              </a>
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <div key={stat.label} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  </div>
                  <div className={`${stat.color} p-3 rounded-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {loadingData ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading your data...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-2 rounded-lg">
                    <GraduationCap className="w-6 h-6 text-blue-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">My Section</h2>
                </div>
              </div>
              <div className="p-6">
                {section ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-gray-500">Section Code</p>
                      <p className="text-lg font-semibold text-gray-900">{section.section_code}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Semester</p>
                      <p className="text-lg font-semibold text-gray-900">{section.semester}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Academic Year</p>
                      <p className="text-lg font-semibold text-gray-900">{section.academic_year}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Professor</p>
                      <p className="text-lg font-semibold text-gray-900">{section.professor_name}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">Not enrolled in any section</p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-green-100 p-2 rounded-lg">
                      <Users className="w-6 h-6 text-green-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900">Classmates</h2>
                  </div>
                  <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded-full">
                    {classmates.length}
                  </span>
                </div>
              </div>
              <div className="p-6">
                {classmates.length > 0 ? (
                  <>
                    <div className="space-y-3 min-h-96">
                      {classmates
                        .slice(classmatePage * CLASSMATES_PER_PAGE, (classmatePage + 1) * CLASSMATES_PER_PAGE)
                        .map((classmate) => (
                          <div 
                            key={classmate.student_number} 
                            className={`p-4 border rounded-lg ${
                              classmate.student_number === user?.studentId 
                                ? 'bg-blue-50 border-blue-200' 
                                : 'bg-gray-50 border-gray-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-semibold text-gray-900">
                                  {classmate.first_name} {classmate.last_name}
                                  {classmate.student_number === user?.studentId && (
                                    <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-1 rounded">You</span>
                                  )}
                                </p>
                                <p className="text-sm text-gray-500">ID: {classmate.student_number}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium text-gray-700">
                                  {classmate.attendance_stats.attendance_rate}%
                                </p>
                                <p className="text-xs text-gray-500">Attendance</p>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {classmates.length > CLASSMATES_PER_PAGE && (
                      <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-200">
                        <button
                          onClick={() => setClassmatePage(Math.max(0, classmatePage - 1))}
                          disabled={classmatePage === 0}
                          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          Previous
                        </button>
                        <span className="text-sm text-gray-600">
                          Page {classmatePage + 1} of {Math.ceil(classmates.length / CLASSMATES_PER_PAGE)}
                        </span>
                        <button
                          onClick={() => setClassmatePage(Math.min(Math.ceil(classmates.length / CLASSMATES_PER_PAGE) - 1, classmatePage + 1))}
                          disabled={classmatePage >= Math.ceil(classmates.length / CLASSMATES_PER_PAGE) - 1}
                          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-8">No classmates found</p>
                )}
              </div>
            </div>
          </div>
        )}

        <AttendanceCalendar records={attendanceRecords} />
      </main>
    </div>
  )
}
