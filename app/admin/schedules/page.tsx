'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Plus, Edit, Trash2, Clock, MapPin } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Swal from 'sweetalert2'

interface ClassSession {
  id: string
  section_id: string
  section_code: string
  professor_id: string
  professor_name: string
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

export default function SchedulesPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const supabase = createClient()

  const [classSessions, setClassSessions] = useState<ClassSession[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [professors, setProfessors] = useState<Professor[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingSession, setEditingSession] = useState<ClassSession | null>(null)

  const [formData, setFormData] = useState({
    section_id: '',
    professor_id: '',
    day_of_week: 'Monday',
    start_time: '08:00',
    end_time: '09:00',
    room: '',
    max_capacity: 40
  })

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
        section_id: formData.section_id,
        professor_id: formData.professor_id,
        day_of_week: formData.day_of_week,
        start_time: `${formData.start_time}:00`,
        end_time: `${formData.end_time}:00`,
        room: formData.room,
        max_capacity: formData.max_capacity
      }

      if (editingSession) {
        // Update existing
        const { error } = await supabase
          .from('class_sessions')
          .update(sessionData)
          .eq('id', editingSession.id)

        if (error) throw error

        await Swal.fire({
          title: 'Success!',
          text: 'Schedule updated successfully',
          icon: 'success',
          confirmButtonColor: '#7c3aed'
        })
      } else {
        // Create new
        const { error } = await supabase
          .from('class_sessions')
          .insert([sessionData])

        if (error) throw error

        await Swal.fire({
          title: 'Success!',
          text: 'Schedule created successfully',
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
    const result = await Swal.fire({
      title: 'Delete Schedule',
      html: `Are you sure you want to delete the schedule for <strong>${session.section_code}</strong> on <strong>${session.day_of_week}</strong> at <strong>${session.start_time}</strong>?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#dc2626',
      cancelButtonText: 'Cancel',
      reverseButtons: true
    })

    if (result.isConfirmed) {
      try {
        const { error } = await supabase
          .from('class_sessions')
          .delete()
          .eq('id', session.id)

        if (error) throw error

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
                <h1 className="text-2xl font-bold text-gray-900">Manage Schedule</h1>
                <p className="text-sm text-gray-600 mt-1">Create and manage class schedules</p>
              </div>
            </div>
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Schedule
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loadingData ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading schedules...</p>
          </div>
        ) : classSessions.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600 mb-4">No schedules created yet</p>
            <button
              onClick={() => handleOpenModal()}
              className="text-violet-600 hover:text-violet-700 font-medium"
            >
              Create your first schedule
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Group by day of week */}
            {DAYS_OF_WEEK.map((day) => {
              const daySchedules = classSessions.filter(s => s.day_of_week === day)
              if (daySchedules.length === 0) return null

              return (
                <div key={day} className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="px-6 py-4 bg-gradient-to-r from-violet-50 to-purple-50 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">{day}</h3>
                  </div>
                  <div className="divide-y divide-gray-200">
                    {daySchedules.map((session) => (
                      <div key={session.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                          <div className="flex items-center gap-3">
                            <Clock className="w-5 h-5 text-violet-600" />
                            <div>
                              <p className="font-semibold text-gray-900">{session.start_time} - {session.end_time}</p>
                              <p className="text-sm text-gray-600">{session.section_code}</p>
                            </div>
                          </div>

                          <div>
                            <p className="text-sm text-gray-600">Professor</p>
                            <p className="font-medium text-gray-900">{session.professor_name}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            <MapPin className="w-5 h-5 text-gray-400" />
                            <div>
                              <p className="text-sm text-gray-600">Room</p>
                              <p className="font-medium text-gray-900">{session.room}</p>
                            </div>
                          </div>

                          <div>
                            <p className="text-sm text-gray-600">Capacity</p>
                            <p className="font-medium text-gray-900">{session.max_capacity} students</p>
                          </div>

                          <div className="col-span-2 flex justify-end gap-2">
                            <button
                              onClick={() => handleOpenModal(session)}
                              className="px-4 py-2 text-sm font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors flex items-center gap-2"
                            >
                              <Edit className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteSchedule(session)}
                              className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-2"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-96 overflow-y-auto p-6">
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                >
                  <option value="">Select a professor</option>
                  {professors.map((professor) => (
                    <option key={professor.id} value={professor.id}>
                      {professor.first_name} {professor.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Day of Week */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Day of Week *</label>
                <select
                  value={formData.day_of_week}
                  onChange={(e) => setFormData({ ...formData, day_of_week: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                >
                  {DAYS_OF_WEEK.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
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
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  >
                    {TIMES.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Time *</label>
                  <select
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  >
                    {TIMES.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Room */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Room/Building *</label>
                <input
                  type="text"
                  value={formData.room}
                  onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                  placeholder="e.g., Room 101 or Lab 2"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
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
    </div>
  )
}
