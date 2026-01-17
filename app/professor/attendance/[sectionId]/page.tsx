'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Camera, Check, X, Clock, MapPin, Users as UsersIcon, AlertCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface Student {
  id: string
  student_id: string
  first_name: string
  last_name: string
  enrollment_id: string
  attendance_status: 'present' | 'absent' | 'late' | null
}

interface SessionInfo {
  section_name: string
  course_code: string
  course_name: string
  day_of_week: string
  start_time: string
  end_time: string
  room: string
}

export default function AttendancePage({ params }: { params: { sectionId: string } }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const scheduleId = searchParams.get('schedule')
  const [students, setStudents] = useState<Student[]>([])
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'professor' && user.role !== 'adviser'))) {
      router.push('/professor/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user && params.sectionId && scheduleId) {
      fetchSessionData()
    }
  }, [user, params.sectionId, scheduleId])

  const fetchSessionData = async () => {
    try {
      // Fetch schedule and section info
      const { data: scheduleData, error: scheduleError } = await supabase
        .from('section_schedules')
        .select(`
          day_of_week,
          start_time,
          end_time,
          room,
          sections (
            section_name,
            courses (
              course_code,
              course_name
            )
          )
        `)
        .eq('id', scheduleId)
        .single()

      if (scheduleError) throw scheduleError

      setSessionInfo({
        section_name: (scheduleData.sections as any)?.section_name || '',
        course_code: (scheduleData.sections as any)?.courses?.course_code || '',
        course_name: (scheduleData.sections as any)?.courses?.course_name || '',
        day_of_week: scheduleData.day_of_week,
        start_time: scheduleData.start_time,
        end_time: scheduleData.end_time,
        room: scheduleData.room || 'TBA',
      })

      // Fetch enrolled students
      const { data: enrollmentsData, error: enrollmentError } = await supabase
        .from('enrollments')
        .select(`
          id,
          users (
            id,
            student_id,
            first_name,
            last_name
          )
        `)
        .eq('section_id', params.sectionId)
        .order('users(last_name)')

      if (enrollmentError) throw enrollmentError

      // Check existing attendance records for today
      const { data: attendanceData } = await supabase
        .from('attendance_records')
        .select('student_id, status')
        .eq('section_id', params.sectionId)
        .eq('date', currentDate)

      const attendanceMap = new Map(
        attendanceData?.map(a => [a.student_id, a.status]) || []
      )

      const studentsList: Student[] = enrollmentsData?.map((enrollment: any) => ({
        id: enrollment.users.id,
        student_id: enrollment.users.student_id,
        first_name: enrollment.users.first_name,
        last_name: enrollment.users.last_name,
        enrollment_id: enrollment.id,
        attendance_status: attendanceMap.get(enrollment.users.id) || null,
      })) || []

      setStudents(studentsList)
    } catch (err: any) {
      console.error('Error fetching session data:', err)
      setError(err.message || 'Failed to load session data')
    } finally {
      setLoadingData(false)
    }
  }

  const markAttendance = (studentId: string, status: 'present' | 'absent' | 'late') => {
    setStudents(prev =>
      prev.map(s =>
        s.id === studentId ? { ...s, attendance_status: status } : s
      )
    )
  }

  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, attendance_status: 'present' as const })))
  }

  const markAllAbsent = () => {
    setStudents(prev => prev.map(s => ({ ...s, attendance_status: 'absent' as const })))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError('')
    setSuccess('')

    try {
      const attendanceRecords = students
        .filter(s => s.attendance_status !== null)
        .map(s => ({
          student_id: s.id,
          section_id: params.sectionId,
          date: currentDate,
          status: s.attendance_status,
          marked_by: user?.id,
        }))

      if (attendanceRecords.length === 0) {
        setError('Please mark attendance for at least one student')
        setIsSaving(false)
        return
      }

      // Upsert attendance records
      const { error: saveError } = await supabase
        .from('attendance_records')
        .upsert(attendanceRecords, {
          onConflict: 'student_id,section_id,date',
          ignoreDuplicates: false,
        })

      if (saveError) throw saveError

      setSuccess('Attendance saved successfully!')
      setTimeout(() => router.push('/professor'), 2000)
    } catch (err: any) {
      console.error('Error saving attendance:', err)
      setError(err.message || 'Failed to save attendance')
    } finally {
      setIsSaving(false)
    }
  }

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading session...</p>
        </div>
      </div>
    )
  }

  if (!user || !sessionInfo) {
    return null
  }

  const presentCount = students.filter(s => s.attendance_status === 'present').length
  const absentCount = students.filter(s => s.attendance_status === 'absent').length
  const lateCount = students.filter(s => s.attendance_status === 'late').length
  const unmarkedCount = students.filter(s => s.attendance_status === null).length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/professor')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900">Mark Attendance</h1>
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                <span className="font-medium">{sessionInfo.section_name}</span>
                <span>•</span>
                <span>{sessionInfo.course_code} - {sessionInfo.course_name}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Messages */}
        {error && (
          <div className="mb-6 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-4">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-6 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-4">
            <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
            <p className="text-green-600 text-sm">{success}</p>
          </div>
        )}

        {/* Session Info */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="text-xs text-gray-600">Time</div>
                <div className="font-medium text-gray-900">
                  {sessionInfo.start_time} - {sessionInfo.end_time}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="text-xs text-gray-600">Room</div>
                <div className="font-medium text-gray-900">{sessionInfo.room}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <UsersIcon className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="text-xs text-gray-600">Total Students</div>
                <div className="font-medium text-gray-900">{students.length}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="text-xs text-gray-600">Date</div>
                <div className="font-medium text-gray-900">
                  {new Date(currentDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">Present</div>
            <div className="text-2xl font-bold text-green-600">{presentCount}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">Absent</div>
            <div className="text-2xl font-bold text-red-600">{absentCount}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">Late</div>
            <div className="text-2xl font-bold text-yellow-600">{lateCount}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">Unmarked</div>
            <div className="text-2xl font-bold text-gray-600">{unmarkedCount}</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={markAllPresent}
            className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
          >
            Mark All Present
          </button>
          <button
            onClick={markAllAbsent}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
          >
            Mark All Absent
          </button>
        </div>

        {/* Student List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Student List</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {students.map((student, index) => (
              <div key={student.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {index + 1}. {student.last_name}, {student.first_name}
                    </div>
                    <div className="text-sm text-gray-600">ID: {student.student_id}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => markAttendance(student.id, 'present')}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        student.attendance_status === 'present'
                          ? 'bg-green-600 text-white'
                          : 'bg-green-100 text-green-700 hover:bg-green-200'
                      }`}
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => markAttendance(student.id, 'late')}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        student.attendance_status === 'late'
                          ? 'bg-yellow-600 text-white'
                          : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                      }`}
                    >
                      <Clock className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => markAttendance(student.id, 'absent')}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        student.attendance_status === 'absent'
                          ? 'bg-red-600 text-white'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                      }`}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => router.push('/professor')}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || unmarkedCount === students.length}
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-emerald-400 transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Attendance'}
          </button>
        </div>
      </main>
    </div>
  )
}
