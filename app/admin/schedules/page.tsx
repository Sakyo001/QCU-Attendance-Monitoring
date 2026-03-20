'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Plus, Edit, Trash2, Clock, MapPin, Upload, FileSpreadsheet, CheckCircle, AlertCircle, X } from 'lucide-react'
import { confirmDelete } from '@/lib/confirm-delete'
import Swal from 'sweetalert2'
import * as XLSX from 'xlsx'

interface ClassSession {
  id: string
  section_id: string
  section_code: string
  professor_id: string
  professor_name: string
  subject_code?: string | null
  subject_name?: string | null
  room: string
  day_of_week: string
  start_time: string
  end_time: string
  max_capacity: number
}

interface Section {
  id: string
  section_code: string
}

interface Professor {
  id: string
  first_name: string
  last_name: string
  email: string
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const TIMES = Array.from({ length: 24 }, (_, i) => {
  const hour = i.toString().padStart(2, '0')
  return `${hour}:00`
})

function formatTimeToAmPm(time: string): string {
  const [hourStr, minuteStr] = time.split(':')
  const hour = parseInt(hourStr, 10)
  const minute = minuteStr || '00'
  const period = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${minute} ${period}`
}

export default function SchedulesPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [classSessions, setClassSessions] = useState<ClassSession[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [professors, setProfessors] = useState<Professor[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [editingSession, setEditingSession] = useState<ClassSession | null>(null)

  const [formData, setFormData] = useState({
    section_id: '',
    professor_id: '',
    subject_code: '',
    subject_name: '',
    day_of_week: 'Monday',
    start_time: '08:00',
    end_time: '09:00',
    room: '',
    max_capacity: 40
  })

  const [filterDay, setFilterDay] = useState('')
  const [filterProfessor, setFilterProfessor] = useState('')
  const [filterSection, setFilterSection] = useState('')

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      fetchData()
    }
  }, [user])

  const fetchData = async () => {
    try {
      setLoadingData(true)

      // Fetch from API route (uses server-side service role, bypasses RLS)
      const response = await fetch('/api/admin/schedules', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.details?.message || errorData.error || 'Failed to fetch schedules')
      }

      const data = await response.json()

      console.log('Fetched data from API:', data)
      setClassSessions(data.classSessions || [])
      setSections(data.sections || [])
      setProfessors(data.professors || [])
    } catch (error) {
      console.error('Error fetching data:', error)
      await Swal.fire({
        title: 'Error!',
        text: `Failed to load schedules: ${error instanceof Error ? error.message : 'Unknown error'}`,
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      })
    } finally {
      setLoadingData(false)
    }
  }

  const handleOpenModal = (session?: ClassSession) => {
    if (session) {
      setEditingSession(session)
      setFormData({
        section_id: session.section_id,
        professor_id: session.professor_id,
        subject_code: session.subject_code || '',
        subject_name: session.subject_name || '',
        day_of_week: session.day_of_week,
        start_time: session.start_time.substring(0, 5),
        end_time: session.end_time.substring(0, 5),
        room: session.room,
        max_capacity: session.max_capacity
      })
    } else {
      setEditingSession(null)
      setFormData({
        section_id: '',
        professor_id: '',
        subject_code: '',
        subject_name: '',
        day_of_week: 'Monday',
        start_time: '08:00',
        end_time: '09:00',
        room: '',
        max_capacity: 40
      })
    }
    setShowModal(true)
  }

  const handleSaveSchedule = async () => {
    if (!formData.section_id || !formData.professor_id || !formData.room) {
      await Swal.fire({
        title: 'Missing Information',
        text: 'Please fill in all required fields',
        icon: 'warning',
        confirmButtonColor: '#7c3aed'
      })
      return
    }

    if (formData.start_time >= formData.end_time) {
      await Swal.fire({
        title: 'Invalid Time',
        text: 'End time must be after start time',
        icon: 'warning',
        confirmButtonColor: '#7c3aed'
      })
      return
    }

    try {
      const sessionData = {
        id: editingSession?.id,
        section_id: formData.section_id,
        professor_id: formData.professor_id,
        subject_code: formData.subject_code.trim() || null,
        subject_name: formData.subject_name.trim() || null,
        day_of_week: formData.day_of_week,
        start_time: formData.start_time,
        end_time: formData.end_time,
        room: formData.room,
        max_capacity: formData.max_capacity
      }

      if (editingSession) {
        const response = await fetch('/api/admin/schedules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionData),
        })

        const result = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(result?.error || 'Failed to update schedule')
        }

        await Swal.fire({
          title: 'Success!',
          text: 'Schedule updated successfully',
          icon: 'success',
          confirmButtonColor: '#7c3aed'
        })
      } else {
        const response = await fetch('/api/admin/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionData),
        })

        const result = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(result?.error || 'Failed to create schedule')
        }

        await Swal.fire({
          title: 'Success!',
          text: result?.updatedExisting
            ? 'Matching schedule already existed, so it was updated successfully'
            : 'Schedule created successfully',
          icon: 'success',
          confirmButtonColor: '#7c3aed'
        })
      }

      setShowModal(false)
      await fetchData()
    } catch (error: any) {
      console.error('Error saving schedule:', error)
      await Swal.fire({
        title: 'Error!',
        text: error.message || 'Failed to save schedule',
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      })
    }
  }

  const handleDeleteSchedule = async (session: ClassSession) => {
    const isConfirmed = await confirmDelete({
      title: 'Delete Schedule',
      html: `Are you sure you want to delete the schedule for <strong>${session.section_code}</strong> on <strong>${session.day_of_week}</strong> at <strong>${session.start_time}</strong>?`,
    })

    if (isConfirmed) {
      try {
        const response = await fetch('/api/admin/schedules', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: session.id }),
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            data?.details?.message ||
            data?.error ||
            `Failed to delete schedule (HTTP ${response.status})`
          throw new Error(message)
        }

        await Swal.fire({
          title: 'Deleted!',
          text: 'Schedule deleted successfully',
          icon: 'success',
          confirmButtonColor: '#7c3aed'
        })

        await fetchData()
      } catch (error: any) {
        console.error('Error deleting schedule:', error)
        await Swal.fire({
          title: 'Error!',
          text: error.message || 'Failed to delete schedule',
          icon: 'error',
          confirmButtonColor: '#7c3aed'
        })
      }
    }
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  const filteredSessions = classSessions.filter(s => {
    if (filterDay && s.day_of_week !== filterDay) return false
    if (filterProfessor && s.professor_id !== filterProfessor) return false
    if (filterSection && s.section_id !== filterSection) return false
    return true
  })

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
                <h1 className="text-2xl font-bold text-gray-900">Schedule Management</h1>
                <p className="text-sm text-gray-600 mt-1">Create and manage class schedules</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload Schedule File
              </button>
              <button
                onClick={() => handleOpenModal()}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Schedule
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Total Schedules</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">{classSessions.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Today&apos;s Classes</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {classSessions.filter(s => s.day_of_week === new Date().toLocaleDateString('en-US', { weekday: 'long' })).length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Active Professors</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {new Set(classSessions.map(s => s.professor_id)).size}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Filter Schedules</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Day of Week</label>
              <select
                value={filterDay}
                onChange={(e) => setFilterDay(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All Days</option>
                {DAYS_OF_WEEK.map(day => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Professor</label>
              <select
                value={filterProfessor}
                onChange={(e) => setFilterProfessor(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All Professors</option>
                {professors.map(prof => (
                  <option key={prof.id} value={prof.id}>{prof.first_name} {prof.last_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Section</label>
              <select
                value={filterSection}
                onChange={(e) => setFilterSection(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All Sections</option>
                {sections.map(section => (
                  <option key={section.id} value={section.id}>{section.section_code}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">All Schedules</h2>
          </div>

          {loadingData ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading schedules...</p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600 mb-4">No schedules found</p>
              {classSessions.length === 0 && (
                <button
                  onClick={() => handleOpenModal()}
                  className="text-violet-600 hover:text-violet-700 font-medium"
                >
                  Create your first schedule
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Section</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Professor</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Day</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Room</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Capacity</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredSessions.map((session) => (
                    <tr key={session.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {session.section_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {session.professor_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-violet-100 text-violet-800">
                          {session.day_of_week}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4 text-gray-400" />
                          {session.start_time.substring(0, 5)} – {session.end_time.substring(0, 5)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center gap-1">
                          <MapPin className="w-4 h-4 text-gray-400" />
                          {session.room}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {session.max_capacity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleOpenModal(session)}
                            className="text-violet-600 hover:text-violet-900 transition-colors"
                            title="Edit schedule"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteSchedule(session)}
                            className="text-red-600 hover:text-red-900 transition-colors"
                            title="Delete schedule"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              {editingSession ? 'Edit Schedule' : 'Create New Schedule'}
            </h2>

            <div className="space-y-4 mb-6">
              {/* Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Section *</label>
                <select
                  value={formData.section_id}
                  onChange={(e) => setFormData({ ...formData, section_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">Select a section</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.section_code}
                    </option>
                  ))}
                </select>
              </div>

              {/* Professor */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Professor *</label>
                <select
                  value={formData.professor_id}
                  onChange={(e) => setFormData({ ...formData, professor_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">Select a professor</option>
                  {professors.map((professor) => (
                    <option key={professor.id} value={professor.id}>
                      {professor.first_name} {professor.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subject Code */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Subject Code</label>
                <input
                  type="text"
                  value={formData.subject_code}
                  onChange={(e) => setFormData({ ...formData, subject_code: e.target.value.toUpperCase() })}
                  placeholder="e.g., CC112"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Subject Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Subject Name</label>
                <input
                  type="text"
                  value={formData.subject_name}
                  onChange={(e) => setFormData({ ...formData, subject_name: e.target.value })}
                  placeholder="e.g., Computer Programming 1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Day of Week */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Day of Week *</label>
                <select
                  value={formData.day_of_week}
                  onChange={(e) => setFormData({ ...formData, day_of_week: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {DAYS_OF_WEEK.map((day) => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
              </div>

              {/* Times */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Time *</label>
                  <select
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {TIMES.map((time) => (
                      <option key={time} value={time}>{formatTimeToAmPm(time)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Time *</label>
                  <select
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {TIMES.map((time) => (
                      <option key={time} value={time}>{formatTimeToAmPm(time)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Room */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Room / Building *</label>
                <input
                  type="text"
                  value={formData.room}
                  onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                  placeholder="e.g., Room 101 or Lab 2"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Capacity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Capacity</label>
                <input
                  type="number"
                  value={formData.max_capacity}
                  onChange={(e) => setFormData({ ...formData, max_capacity: parseInt(e.target.value) })}
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSchedule}
                className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors"
              >
                {editingSession ? 'Update Schedule' : 'Create Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUploadModal && (
        <AdminUploadClassListModal
          professors={professors}
          onClose={() => setShowUploadModal(false)}
          onComplete={() => {
            setShowUploadModal(false)
            fetchData()
          }}
        />
      )}
    </div>
  )
}

interface ParsedSchedule {
  schedKey: string
  subjectCode: string
  subjectName: string
  dayOfWeek: string
  startTime: string
  endTime: string
  room: string
}

interface ParsedStudent {
  studentNumber: string
  firstName: string
  lastName: string
  middleName: string | null
  email: string
}

interface ParsedSection {
  sectionCode: string
  semester: string
  academicYear: string
  course: string
  yearLevel: string
  schedules: ParsedSchedule[]
  students: ParsedStudent[]
  selected: boolean
  selectedScheduleKeys: string[]
}

interface AdminUploadClassListModalProps {
  professors: Professor[]
  onClose: () => void
  onComplete: () => void
}

const DAY_CODE_MAP: Record<string, string> = {
  M: 'Monday',
  T: 'Tuesday',
  W: 'Wednesday',
  TH: 'Thursday',
  F: 'Friday',
  S: 'Saturday',
  SU: 'Sunday',
}

function dayCodeToName(code: string): string {
  const upper = (code || '').trim().toUpperCase()
  return DAY_CODE_MAP[upper] || upper
}

function excelTimeToHHMM(value: unknown): string {
  if (value === null || value === undefined || value === '') return '00:00'

  if (typeof value === 'number' && Number.isFinite(value)) {
    const totalMinutes = Math.round(value * 24 * 60)
    const h = Math.floor(totalMinutes / 60) % 24
    const m = totalMinutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const text = String(value).trim()
  if (!text) return '00:00'

  const match12 = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i)
  if (match12) {
    let h = parseInt(match12[1], 10)
    const m = parseInt(match12[2], 10)
    const ampm = match12[3].toUpperCase()
    if (ampm === 'AM' && h === 12) h = 0
    if (ampm === 'PM' && h !== 12) h += 12
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const match24 = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (match24) {
    const h = Math.min(23, Math.max(0, parseInt(match24[1], 10)))
    const m = Math.min(59, Math.max(0, parseInt(match24[2], 10)))
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  return '00:00'
}

function formatTime12h(time: string): string {
  if (!time) return ''
  const [hStr, mStr] = time.split(':')
  let h = parseInt(hStr, 10)
  const m = parseInt(mStr || '0', 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}

function AdminUploadClassListModal({ professors, onClose, onComplete }: AdminUploadClassListModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'uploading' | 'done'>('upload')
  const [selectedProfessorId, setSelectedProfessorId] = useState('')
  const [parsedSections, setParsedSections] = useState<ParsedSection[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [uploadResult, setUploadResult] = useState<any>(null)
  const [progress, setProgress] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result
        const workbook = XLSX.read(data, { type: 'binary' })
        const sheetName = workbook.SheetNames[0]
        const ws = workbook.Sheets[sheetName]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'HH:mm' })

        if (rows.length < 2) {
          setParseError('The file appears to be empty or has no data rows.')
          return
        }

        const COL = {
          CLASS: 2,
          CLASS_YRLVL: 4,
          SUBCODE: 5,
          SUBJECT: 6,
          STUDNO: 8,
          LASTNAME: 9,
          FIRSTNAME: 10,
          MIDDLENAME: 11,
          DAYSCODE: 13,
          START: 14,
          END: 15,
          STUDENT_COURSE: 16,
          EMAIL: 18,
          SY: 22,
          ROOM: 28,
        }

        const sectionMap = new Map<string, {
          semester: string
          academicYear: string
          course: string
          yearLevel: string
          scheduleSet: Map<string, ParsedSchedule>
          studentMap: Map<string, ParsedStudent>
        }>()

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          if (!row || !row[COL.CLASS] || !row[COL.STUDNO]) continue

          const sectionCode = String(row[COL.CLASS]).trim()
          const studNo = String(row[COL.STUDNO]).trim()
          if (!sectionCode || !studNo) continue

          if (!sectionMap.has(sectionCode)) {
            sectionMap.set(sectionCode, {
              semester: '2nd Semester',
              academicYear: row[COL.SY] ? String(row[COL.SY]).trim() : '2025-2026',
              course: row[COL.STUDENT_COURSE] ? String(row[COL.STUDENT_COURSE]).trim() : '',
              yearLevel: row[COL.CLASS_YRLVL] ? String(row[COL.CLASS_YRLVL]).trim() : '',
              scheduleSet: new Map(),
              studentMap: new Map(),
            })
          }

          const sec = sectionMap.get(sectionCode)!

          const subCode = row[COL.SUBCODE] ? String(row[COL.SUBCODE]).trim() : ''
          const dayRaw = row[COL.DAYSCODE] ? String(row[COL.DAYSCODE]).trim() : ''
          const startRaw = row[COL.START] ?? ''
          const endRaw = row[COL.END] ?? ''
          const room = row[COL.ROOM] ? String(row[COL.ROOM]).trim() : 'TBA'
          const day = dayCodeToName(dayRaw)
          const startTime = excelTimeToHHMM(startRaw)
          const endTime = excelTimeToHHMM(endRaw)

          if (subCode && day) {
            const schedKey = `${subCode}|${day}|${startTime}|${endTime}`
            if (!sec.scheduleSet.has(schedKey)) {
              sec.scheduleSet.set(schedKey, {
                schedKey,
                subjectCode: subCode,
                subjectName: row[COL.SUBJECT] ? String(row[COL.SUBJECT]).trim() : subCode,
                dayOfWeek: day,
                startTime,
                endTime,
                room,
              })
            }
          }

          if (!sec.studentMap.has(studNo)) {
            sec.studentMap.set(studNo, {
              studentNumber: studNo,
              firstName: row[COL.FIRSTNAME] ? String(row[COL.FIRSTNAME]).trim() : '',
              lastName: row[COL.LASTNAME] ? String(row[COL.LASTNAME]).trim() : '',
              middleName: row[COL.MIDDLENAME] ? String(row[COL.MIDDLENAME]).trim() : null,
              email: row[COL.EMAIL] ? String(row[COL.EMAIL]).trim() : '',
            })
          }
        }

        const parsed: ParsedSection[] = Array.from(sectionMap.entries())
          .map(([code, data]) => {
            const schedules = Array.from(data.scheduleSet.values())
            return {
              sectionCode: code,
              semester: data.semester,
              academicYear: data.academicYear,
              course: data.course,
              yearLevel: data.yearLevel,
              schedules,
              students: Array.from(data.studentMap.values()),
              selected: false,
              selectedScheduleKeys: schedules.map((s) => s.schedKey),
            }
          })
          .sort((a, b) => a.sectionCode.localeCompare(b.sectionCode))

        setParsedSections(parsed)
        setStep('preview')
      } catch (err: any) {
        console.error('XLSX parse error:', err)
        setParseError(err.message || 'Failed to parse file')
      }
    }
    reader.readAsBinaryString(file)
  }, [])

  const toggleSection = (sectionCode: string) => {
    setParsedSections((prev) =>
      prev.map((s) => (s.sectionCode === sectionCode ? { ...s, selected: !s.selected } : s))
    )
  }

  const toggleSchedule = (sectionCode: string, schedKey: string) => {
    setParsedSections((prev) =>
      prev.map((s) => {
        if (s.sectionCode !== sectionCode) return s
        const isSelected = s.selectedScheduleKeys.includes(schedKey)
        return {
          ...s,
          selectedScheduleKeys: isSelected
            ? s.selectedScheduleKeys.filter((k) => k !== schedKey)
            : [...s.selectedScheduleKeys, schedKey],
        }
      })
    )
  }

  const selectedSections = parsedSections.filter((s) => s.selected)

  const handleSubmit = async () => {
    if (!selectedProfessorId) {
      setParseError('Please select a professor before importing.')
      return
    }

    if (selectedSections.length === 0) return

    setStep('uploading')
    setProgress('Uploading class list...')

    try {
      const payload = {
        professorId: selectedProfessorId,
        sections: selectedSections.map(({ selected, selectedScheduleKeys, ...rest }) => ({
          ...rest,
          schedules: rest.schedules.filter((s) => selectedScheduleKeys.includes(s.schedKey)),
        })),
      }

      const response = await fetch('/api/admin/upload-classlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Upload failed')
      }

      setUploadResult(result)
      setStep('done')
    } catch (err: any) {
      setUploadResult({ error: err.message })
      setStep('done')
    }
  }

  const [searchQuery, setSearchQuery] = useState('')
  const [courseFilter, setCourseFilter] = useState('')
  const [yearLevelFilter, setYearLevelFilter] = useState('')

  const uniqueCourses = Array.from(new Set(parsedSections.map((s) => s.course).filter(Boolean))).sort()
  const uniqueYearLevels = Array.from(new Set(parsedSections.map((s) => s.yearLevel).filter(Boolean))).sort()

  const filteredSections = parsedSections.filter((s) => {
    const matchesSearch =
      !searchQuery ||
      s.sectionCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.schedules.some((sc) => sc.subjectCode.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesCourse = !courseFilter || s.course === courseFilter
    const matchesYear = !yearLevelFilter || s.yearLevel === yearLevelFilter
    return matchesSearch && matchesCourse && matchesYear
  })

  const toggleAllFiltered = () => {
    const filteredCodes = new Set(filteredSections.map((s) => s.sectionCode))
    const allFilteredSelected = filteredSections.every((s) => s.selected)
    setParsedSections((prev) =>
      prev.map((s) =>
        filteredCodes.has(s.sectionCode) ? { ...s, selected: !allFilteredSelected } : s
      )
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Upload Schedule File</h2>
              <p className="text-sm text-gray-500">
                {step === 'upload' && 'Select an Excel file (.xlsx) to import sections and students'}
                {step === 'preview' && `${parsedSections.length} sections found — select which ones to import`}
                {step === 'uploading' && 'Creating sections, schedules, and students...'}
                {step === 'done' && 'Upload complete'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-full max-w-md mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign Imported Schedules To Professor *</label>
                <select
                  value={selectedProfessorId}
                  onChange={(e) => setSelectedProfessorId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a professor</option>
                  {professors.map((prof) => (
                    <option key={prof.id} value={prof.id}>{prof.first_name} {prof.last_name}</option>
                  ))}
                </select>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all w-full max-w-md"
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-700 font-medium">Click to select file</p>
                <p className="text-sm text-gray-500 mt-1">Supports .xlsx files</p>
                {fileName && (
                  <p className="text-sm text-indigo-600 mt-3 font-medium">{fileName}</p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              {parseError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2 max-w-md w-full">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {parseError}
                </div>
              )}
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Professor</label>
                  <select
                    value={selectedProfessorId}
                    onChange={(e) => setSelectedProfessorId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select a professor</option>
                    {professors.map((prof) => (
                      <option key={prof.id} value={prof.id}>{prof.first_name} {prof.last_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span>{filteredSections.length} / {parsedSections.length} sections</span>
                  <span>{filteredSections.reduce((s, sec) => s + sec.students.length, 0)} students</span>
                  <span className="font-medium text-indigo-600">{selectedSections.length} selected</span>
                </div>
                <button
                  onClick={toggleAllFiltered}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {filteredSections.length > 0 && filteredSections.every((s) => s.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Search by section or subject..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <select
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">All Courses</option>
                  {uniqueCourses.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={yearLevelFilter}
                  onChange={(e) => setYearLevelFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">All Year Levels</option>
                  {uniqueYearLevels.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {filteredSections.map((section) => (
                  <div
                    key={section.sectionCode}
                    onClick={() => toggleSection(section.sectionCode)}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      section.selected
                        ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={section.selected}
                          readOnly
                          className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 pointer-events-none"
                        />
                        <div>
                          <h4 className="font-semibold text-gray-900">{section.sectionCode}</h4>
                          <p className="text-xs text-gray-500">
                            {section.course && <span className="text-indigo-600 font-medium">{section.course}</span>}
                            {section.course && section.yearLevel && ' • '}
                            {section.yearLevel && <span>{section.yearLevel} Year</span>}
                            {(section.course || section.yearLevel) && ' • '}
                            {section.semester} • {section.academicYear}
                          </p>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="text-gray-700 font-medium">{section.students.length} students</div>
                        <div className={`text-xs ${section.selected && section.selectedScheduleKeys.length < section.schedules.length ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                          {section.selected
                            ? `${section.selectedScheduleKeys.length}/${section.schedules.length} subjects`
                            : `${section.schedules.length} subject${section.schedules.length !== 1 ? 's' : ''}`}
                        </div>
                      </div>
                    </div>
                    {section.selected && section.schedules.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-indigo-200 space-y-1">
                        <p className="text-xs font-medium text-indigo-700 mb-2">Select subjects to create schedules for:</p>
                        {section.schedules.map((sched) => {
                          const isSchedSelected = section.selectedScheduleKeys.includes(sched.schedKey)
                          return (
                            <div
                              key={sched.schedKey}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleSchedule(section.sectionCode, sched.schedKey)
                              }}
                              className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 cursor-pointer transition-colors ${
                                isSchedSelected ? 'bg-indigo-100 text-indigo-800' : 'text-gray-400 line-through hover:bg-gray-100'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSchedSelected}
                                readOnly
                                className="w-3 h-3 pointer-events-none accent-indigo-600"
                              />
                              <span className="font-semibold">{sched.subjectCode}</span>
                              <span className="text-gray-400">-</span>
                              <span>{sched.dayOfWeek} {formatTime12h(sched.startTime)}-{formatTime12h(sched.endTime)}</span>
                              <span className="text-gray-400">({sched.room})</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'uploading' && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-6 text-gray-700 font-medium">{progress}</p>
              <p className="mt-2 text-sm text-gray-500">
                Creating {selectedSections.length} sections and enrolling {selectedSections.reduce((s, sec) => s + sec.students.length, 0)} students...
              </p>
            </div>
          )}

          {step === 'done' && uploadResult && (
            <div className="py-8 space-y-6">
              {uploadResult.error && !uploadResult.success ? (
                <div className="flex flex-col items-center text-center">
                  <div className="bg-red-100 p-4 rounded-full mb-4">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-red-800">Upload Failed</h3>
                  <p className="text-sm text-red-600 mt-2">{uploadResult.error}</p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-center text-center">
                    <div className="bg-emerald-100 p-4 rounded-full mb-4">
                      <CheckCircle className="w-8 h-8 text-emerald-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">Upload Complete!</h3>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-emerald-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-emerald-700">{uploadResult.sectionsCreated}</div>
                      <div className="text-xs text-emerald-600 mt-1">Sections Created</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-blue-700">{uploadResult.classSessionsCreated}</div>
                      <div className="text-xs text-blue-600 mt-1">Schedules Created</div>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-indigo-700">{uploadResult.studentsCreated}</div>
                      <div className="text-xs text-indigo-600 mt-1">Students Enrolled</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-gray-700">{uploadResult.studentsExisting}</div>
                      <div className="text-xs text-gray-600 mt-1">Already Existed</div>
                    </div>
                  </div>

                  {uploadResult.errors?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-amber-800 mb-2">
                        {uploadResult.errors.length} warning(s):
                      </h4>
                      <ul className="text-xs text-amber-700 space-y-1 max-h-32 overflow-y-auto">
                        {uploadResult.errors.map((err: string, i: number) => (
                          <li key={i}>- {err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50/50 rounded-b-xl">
          {step === 'preview' && (
            <>
              <button
                onClick={() => {
                  setStep('upload')
                  setParsedSections([])
                  setFileName('')
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={selectedSections.length === 0 || !selectedProfessorId}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                Import {selectedSections.length} Section{selectedSections.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {step === 'done' && (
            <button
              onClick={onComplete}
              className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium transition-colors"
            >
              Done
            </button>
          )}
          {step === 'upload' && (
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
