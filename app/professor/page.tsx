'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BookOpen, Users, Calendar, LogOut, Clock, MapPin, Play } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface Section {
  id: string
  section_code: string
  semester: string
  academic_year: string
  max_students: number
}

interface ClassSession {
  id: string
  section_id: string
  room: string
  max_capacity: number
  day_of_week: string
  start_time: string
  end_time: string
  sections: Section
}

export default function ProfessorDashboard() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  
  const [sections, setSections] = useState<Section[]>([])
  const [classrooms, setClassrooms] = useState<ClassSession[]>([])
  const [loadingSections, setLoadingSections] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [todayClasses, setTodayClasses] = useState(0)

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'professor' && user.role !== 'adviser'))) {
      router.push('/professor/login')
      return
    }
    
    if (!loading && user) {
      fetchSections()
    } else if (!loading && !user) {
      setLoadingSections(false)
    }
  }, [user, loading, router])

  const fetchSections = async () => {
    console.log('Fetching classrooms for user:', user?.id, user?.email)
    setLoadingSections(true)
    
    try {
      if (!user?.id) {
        console.warn('No user ID available, skipping fetch')
        setLoadingSections(false)
        return
      }

      console.log('Querying classrooms for professor:', user.id)

      // Fetch from API endpoint (uses service role to bypass RLS)
      const response = await fetch(`/api/professor/classrooms?professorId=${user.id}`)
      const data = await response.json()

      if (!response.ok) {
        console.error('Error fetching classrooms:', data.error)
        setLoadingSections(false)
        return
      }

      console.log('Classrooms data received:', data.classrooms?.length || 0, 'classrooms')
      setClassrooms(data.classrooms || [])

    } catch (error: any) {
      console.error('Exception in fetchSections:', error)
    } finally {
      setLoadingSections(false)
    }
  }

  if (loading || loadingSections) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
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
    router.push('/professor/login')
  }

  const handleStartSession = (sectionId: string, scheduleId: string) => {
    router.push(`/professor/attendance/${sectionId}`)
  }

  const handleCreateClassroom = async (formData: any) => {
    try {
      const response = await fetch('/api/professor/classroom/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          professorId: user?.id,
          ...formData,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create classroom')
      }

      // Refresh sections to show newly created classroom
      fetchSections()
      setShowCreateModal(false)
    } catch (error: any) {
      console.error('Error creating classroom:', error)
      alert(error.message || 'Failed to create classroom')
    }
  }

  const totalStudents = classrooms.reduce((sum, classroom) => sum + classroom.max_capacity, 0)
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  const stats = [
    { label: 'My Classrooms', value: classrooms.length.toString(), icon: BookOpen, color: 'bg-emerald-500' },
    { label: 'Total Capacity', value: totalStudents.toString(), icon: Users, color: 'bg-blue-500' },
    { label: 'Classes Today', value: classrooms.filter(c => c.day_of_week === today).length.toString(), icon: Calendar, color: 'bg-purple-500' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Professor Dashboard</h1>
              <p className="text-sm text-gray-600 mt-1">
                Welcome back, {user.firstName} {user.lastName}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <BookOpen className="w-4 h-4" />
                Create Classroom
              </button>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <div key={stat.label} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{stat.value}</p>
                  </div>
                  <div className={`${stat.color} p-3 rounded-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* My Classes */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">My Classrooms</h2>
          </div>
          
          {classrooms.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center border border-dashed border-gray-300">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">No classrooms created yet</p>
              <p className="text-sm text-gray-400 mt-1">Create your first classroom to see it here</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {classrooms.map((classroom, index) => {
                const isToday = classroom.day_of_week === today
                const bgColors = [
                  'bg-gradient-to-r from-emerald-600 to-emerald-500',
                  'bg-gradient-to-r from-blue-600 to-blue-500',
                  'bg-gradient-to-r from-indigo-600 to-indigo-500',
                  'bg-gradient-to-r from-violet-600 to-violet-500',
                  'bg-gradient-to-r from-orange-600 to-orange-500',
                  'bg-gradient-to-r from-teal-600 to-teal-500'
                ]
                const headerColor = bgColors[index % bgColors.length]

                return (
                  <div 
                    key={classroom.id} 
                    className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-300 flex flex-col group h-full"
                  >
                    {/* Card Header */}
                    <div className={`${headerColor} p-6 relative h-32`}>
                      <div className="relative z-10 text-white">
                        <div className="flex justify-between items-start">
                          <h3 className="text-2xl font-medium tracking-tight hover:underline decoration-white/50 cursor-pointer">
                            BSIT {classroom.sections.section_code}
                          </h3>
                          {isToday && (
                            <span className="bg-white/20 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                              Today
                            </span>
                          )}
                        </div>
                        <p className="text-white/90 text-sm mt-1">
                          {classroom.sections.semester} • {classroom.sections.academic_year}
                        </p>
                      </div>
                      {/* Decorative Circles */}
                      <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                      <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-16 h-16 bg-black/5 rounded-full blur-xl"></div>
                    </div>

                    {/* Card Content */}
                    <div className="p-4 flex-grow space-y-4">
                      <div className="flex items-start space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                        <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Schedule</p>
                          <p className="text-sm text-gray-500">
                            {classroom.day_of_week}, {classroom.start_time} - {classroom.end_time}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                        <MapPin className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Room</p>
                          <p className="text-sm text-gray-500">{classroom.room}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                        <Users className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Students</p>
                          <p className="text-sm text-gray-500">{classroom.max_capacity} Enrolled</p>
                        </div>
                      </div>
                    </div>

                    {/* Card Footer */}
                    <div className="p-4 border-t border-gray-100 flex justify-end bg-gray-50/50">
                      <button
                        onClick={() => handleStartSession(classroom.section_id, classroom.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          isToday 
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-md' 
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400'
                        }`}
                      >
                        <Play className="w-4 h-4" />
                        {isToday ? 'Start Class' : 'View Class'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {/* Create Classroom Modal */}
      {showCreateModal && (
        <CreateClassroomModal
          sections={sections}
          professorName={`${user?.firstName} ${user?.lastName}`}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateClassroom}
        />
      )}
    </div>
  )
}

interface CreateClassroomModalProps {
  sections: Section[]
  professorName: string
  onClose: () => void
  onSubmit: (data: any) => void
}

function CreateClassroomModal({ sections: initialSections, professorName, onClose, onSubmit }: CreateClassroomModalProps) {
  const supabase = createClient()
  const [formData, setFormData] = useState({
    sectionId: '',
    room: '',
    maxCapacity: '',
    dayOfWeek: '',
    startTime: '',
    endTime: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sections, setSections] = useState<Section[]>(initialSections)
  const [loadingSections, setLoadingSections] = useState(false)

  useEffect(() => {
    fetchSectionsForModal()
  }, [])

  const fetchSectionsForModal = async () => {
    setLoadingSections(true)
    try {
      const { data, error } = await supabase
        .from('sections')
        .select('id, section_code, semester, academic_year, max_students')
        .order('section_code')

      if (error) {
        console.error('Error fetching sections:', error)
        setSections(initialSections)
        return
      }

      setSections(data || [])
    } catch (err) {
      console.error('Exception fetching sections:', err)
      setSections(initialSections)
    } finally {
      setLoadingSections(false)
    }
  }

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      if (!formData.sectionId || !formData.room || !formData.maxCapacity || !formData.dayOfWeek || !formData.startTime || !formData.endTime) {
        throw new Error('All fields are required')
      }

      await onSubmit(formData)
    } catch (error: any) {
      console.error('Error:', error)
      alert(error.message || 'Failed to create classroom')
      setIsSubmitting(false)
    }
  }

  const selectedSection = sections.find(s => s.id === formData.sectionId)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">Create Classroom</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Section */}
          <div>
            <label htmlFor="section" className="block text-sm font-medium text-gray-700 mb-1">
              Section *
            </label>
            <select
              id="section"
              value={formData.sectionId}
              onChange={(e) => setFormData(prev => ({ ...prev, sectionId: e.target.value }))}
              disabled={loadingSections}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">{loadingSections ? 'Loading sections...' : 'Select a section'}</option>
              {sections.map(section => (
                <option key={section.id} value={section.id}>
                  BSIT {section.section_code} - {section.semester} {section.academic_year}
                </option>
              ))}
            </select>
          </div>

          {/* Professor (Read-only) */}
          <div>
            <label htmlFor="professor" className="block text-sm font-medium text-gray-700 mb-1">
              Professor
            </label>
            <input
              type="text"
              id="professor"
              value={professorName}
              disabled
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
            />
          </div>

          {/* Max Capacity (show section capacity, but editable) */}
          <div>
            <label htmlFor="maxCapacity" className="block text-sm font-medium text-gray-700 mb-1">
              Max Capacity *
              {selectedSection && (
                <span className="text-xs text-gray-500 ml-2">
                  (Section capacity: {selectedSection.max_students})
                </span>
              )}
            </label>
            <input
              type="number"
              id="maxCapacity"
              value={formData.maxCapacity}
              onChange={(e) => setFormData(prev => ({ ...prev, maxCapacity: e.target.value }))}
              placeholder={selectedSection?.max_students.toString() || 'Enter max capacity'}
              min="1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Room */}
          <div>
            <label htmlFor="room" className="block text-sm font-medium text-gray-700 mb-1">
              Room *
            </label>
            <input
              type="text"
              id="room"
              value={formData.room}
              onChange={(e) => setFormData(prev => ({ ...prev, room: e.target.value }))}
              placeholder="e.g., Room 101, Lab A"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Schedule */}
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <h3 className="font-medium text-gray-900">Class Schedule</h3>

            <div>
              <label htmlFor="dayOfWeek" className="block text-sm font-medium text-gray-700 mb-1">
                Day of Week *
              </label>
              <select
                id="dayOfWeek"
                value={formData.dayOfWeek}
                onChange={(e) => setFormData(prev => ({ ...prev, dayOfWeek: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Select a day</option>
                {daysOfWeek.map(day => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="startTime" className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time *
                </label>
                <input
                  type="time"
                  id="startTime"
                  value={formData.startTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="endTime" className="block text-sm font-medium text-gray-700 mb-1">
                  End Time *
                </label>
                <input
                  type="time"
                  id="endTime"
                  value={formData.endTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-emerald-400 transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Classroom'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
