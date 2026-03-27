'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { BookOpen, Users, Calendar, LogOut, Clock, MapPin, Play, BarChart3, Upload, FileSpreadsheet, CheckCircle, AlertCircle, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { ClassAccessModal } from '@/components/class-access-modal'
import { offlineSyncService } from '@/lib/offline-sync'
import * as XLSX from 'xlsx'

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
  subject_code?: string | null
  subject_name?: string | null
  day_of_week: string
  start_time: string
  end_time: string
  sections: Section
}

type ClassroomViewMode = 'folder' | 'file'

export default function ProfessorDashboard() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  
  const [sections, setSections] = useState<Section[]>([])
  const [classrooms, setClassrooms] = useState<ClassSession[]>([])
  const [loadingSections, setLoadingSections] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [todayClasses, setTodayClasses] = useState(0)
  const [showClassAccessModal, setShowClassAccessModal] = useState(false)
  const [selectedSectionId, setSelectedSectionId] = useState<string>('')
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const hasFetchedRef = useRef(false)
  const [classroomViewMode, setClassroomViewMode] = useState<ClassroomViewMode>('folder')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('professorDashboard:classroomView')
      if (saved === 'folder' || saved === 'file') {
        setClassroomViewMode(saved)
      }
    } catch {
      // ignore
    }
  }, [])

  const setAndPersistClassroomViewMode = (mode: ClassroomViewMode) => {
    setClassroomViewMode(mode)
    try {
      localStorage.setItem('professorDashboard:classroomView', mode)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    // Authentication check
    if (!loading) {
      if (!user || (user.role !== 'professor' && (user.role as any) !== 'adviser')) {
        router.push('/professor/login')
        return
      }
      
      // User is authenticated, fetch sections only once
      if (!hasFetchedRef.current && user.id) {
        hasFetchedRef.current = true
        fetchSections()
      }
    }
  }, [user, loading])

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

      console.log('API Response:', {
        ok: response.ok,
        status: response.status,
        classroomsCount: data.classrooms?.length || 0,
        usingOfflineCache: data.usingOfflineCache,
        reason: data.reason
      })

      if (!response.ok) {
        console.error('Error fetching classrooms:', data.error)
        setLoadingSections(false)
        return
      }

      if (!data.classrooms || data.classrooms.length === 0) {
        console.warn('⚠️ No classrooms returned from API')
      }

      console.log('Classrooms data received:', data.classrooms?.length || 0, 'classrooms')
      console.log('Data:', JSON.stringify(data.classrooms || [], null, 2))
      setClassrooms(data.classrooms || [])

    } catch (error: any) {
      console.error('Exception in fetchSections:', error)
      setLoadingSections(false)
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
    // Store the selected class info and show the access modal
    setSelectedSectionId(sectionId)
    setSelectedScheduleId(scheduleId)
    setShowClassAccessModal(true)
  }

  const handleFaceRecognitionClick = () => {
    setShowClassAccessModal(false)
    // Navigate to attendance page with entry method parameter
    router.push(`/professor/attendance/${selectedSectionId}?entryMethod=face`)
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

      // Ensure offline cache sync timestamp updates immediately after create.
      await offlineSyncService.triggerSync()

      // Refresh sections to show newly created classroom
      await fetchSections()
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
                onClick={() => router.push('/professor/reports')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                Reports
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload Class List
              </button>
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAndPersistClassroomViewMode('folder')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                  classroomViewMode === 'folder'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Folder view
              </button>
              <button
                type="button"
                onClick={() => setAndPersistClassroomViewMode('file')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                  classroomViewMode === 'file'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                File view
              </button>
            </div>
          </div>
          
          {classrooms.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center border border-dashed border-gray-300">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">No classrooms created yet</p>
              <p className="text-sm text-gray-400 mt-1">Create your first classroom to see it here</p>
            </div>
          ) : classroomViewMode === 'file' ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-medium">Section</th>
                      <th className="px-4 py-3 font-medium">Subject</th>
                      <th className="px-4 py-3 font-medium">Day</th>
                      <th className="px-4 py-3 font-medium">Time</th>
                      <th className="px-4 py-3 font-medium">Room</th>
                      <th className="px-4 py-3 font-medium">Capacity</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {classrooms.map((classroom) => {
                      const isToday = classroom.day_of_week === today
                      const subjectLabel = classroom.subject_code || classroom.subject_name || ''
                      return (
                        <tr key={classroom.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">
                            BSIT {classroom.sections.section_code}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {subjectLabel ? (
                              <span className="font-mono text-xs text-gray-600">{subjectLabel}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{classroom.day_of_week}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                            {formatTime12h(classroom.start_time)} - {formatTime12h(classroom.end_time)}
                          </td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{classroom.room}</td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{classroom.max_capacity}</td>
                          <td className="px-4 py-3">
                            {isToday ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                Today
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                                Scheduled
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              onClick={() => handleStartSession(classroom.section_id, classroom.id)}
                              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                                isToday
                                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400'
                              }`}
                            >
                              <Play className="w-4 h-4" />
                              {isToday ? 'Start Class' : 'View Class'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
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
                        {classroom.subject_code && (
                          <p className="text-white/80 text-xs font-mono mt-0.5">{classroom.subject_code}</p>
                        )}
                        <p className="text-white/90 text-sm mt-1">
                          {classroom.sections.semester} • {classroom.sections.academic_year}
                        </p>
                      </div>
                      {/* Decorative Circles */}
                      <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                      <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-16 h-16 bg-black/5 rounded-full blur-xl"></div>
                    </div>

                    {/* Card Content */}
                    <div className="p-4 grow space-y-4">
                      <div className="flex items-start space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                        <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Schedule</p>
                          <p className="text-sm text-gray-500">
                            {classroom.day_of_week}, {formatTime12h(classroom.start_time)} - {formatTime12h(classroom.end_time)}
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
                    <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
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
          professorId={user.id}
          professorName={`${user?.firstName} ${user?.lastName}`}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateClassroom}
        />
      )}

      {/* Class Access Modal */}
      <ClassAccessModal
        isOpen={showClassAccessModal}
        onClose={() => setShowClassAccessModal(false)}
        onFaceRecognitionClick={handleFaceRecognitionClick}
        professorName={`${user?.firstName} ${user?.lastName}`}
      />

      {/* Upload Class List Modal */}
      {showUploadModal && (
        <UploadClassListModal
          professorId={user.id}
          onClose={() => setShowUploadModal(false)}
          onComplete={() => {
            setShowUploadModal(false)
            hasFetchedRef.current = false
            fetchSections()
          }}
        />
      )}
    </div>
  )
}

interface CreateClassroomModalProps {
  sections: Section[]
  professorId: string
  professorName: string
  onClose: () => void
  onSubmit: (data: any) => void
}

function CreateClassroomModal({ sections: initialSections, professorId, professorName, onClose, onSubmit }: CreateClassroomModalProps) {
  const dedupeSections = (items: Section[]): Section[] => {
    return Array.from(
      new Map(
        items.map((section) => [
          `${section.section_code}|${section.semester}|${section.academic_year}`,
          section,
        ])
      ).values()
    )
  }

  const [formData, setFormData] = useState({
    sectionId: '',
    subjectCode: '',
    subjectName: '',
    room: '',
    maxCapacity: '',
    dayOfWeek: '',
    startTime: '',
    endTime: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sections, setSections] = useState<Section[]>(dedupeSections(initialSections))
  const [loadingSections, setLoadingSections] = useState(false)

  useEffect(() => {
    fetchSectionsForModal()
  }, [])

  const fetchSectionsForModal = async () => {
    setLoadingSections(true)
    try {
      const res = await fetch(`/api/professor/sections?professorId=${encodeURIComponent(professorId)}`)
      const payload = await res.json()

      if (!res.ok) {
        console.error('Error fetching sections:', payload?.error || payload)
        setSections(dedupeSections(initialSections))
        return
      }

      setSections(dedupeSections(((payload?.sections as Section[]) || [])))
    } catch (err) {
      console.error('Exception fetching sections:', err)
      setSections(dedupeSections(initialSections))
    } finally {
      setLoadingSections(false)
    }
  }

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  const isFormValid = () => {
    return !!(formData.sectionId && formData.subjectCode && formData.room && formData.maxCapacity && formData.dayOfWeek && formData.startTime && formData.endTime)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isFormValid()) return

    setIsSubmitting(true)

    try {
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

          {/* Subject Code */}
          <div>
            <label htmlFor="subjectCode" className="block text-sm font-medium text-gray-700 mb-1">
              Subject Code *
            </label>
            <input
              type="text"
              id="subjectCode"
              value={formData.subjectCode}
              onChange={(e) => setFormData(prev => ({ ...prev, subjectCode: e.target.value.toUpperCase() }))}
              placeholder="e.g., CC112, IT-ELEC-1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Subject Name */}
          <div>
            <label htmlFor="subjectName" className="block text-sm font-medium text-gray-700 mb-1">
              Subject Name
            </label>
            <input
              type="text"
              id="subjectName"
              value={formData.subjectName}
              onChange={(e) => setFormData(prev => ({ ...prev, subjectName: e.target.value }))}
              placeholder="e.g., Computer Programming 1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              disabled={isSubmitting || !isFormValid()}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Classroom'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Day code → full day name mapping ─────────────────────────────────────────

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

/** Convert Excel serial time (fraction of day) to "HH:mm" string.
 *  Handles: "14:00", "2:00 PM", "7:00:00 AM", 0.583333, Date objects */
function excelTimeToHHMM(value: any): string {
  if (value == null) return ''

  if (typeof value === 'string') {
    const s = value.trim()
    // Match patterns like "2:00 PM", "11:00 AM", "7:00:00 AM", "14:00", "07:00:00"
    const match = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i)
    if (match) {
      let h = parseInt(match[1], 10)
      const m = parseInt(match[2], 10)
      const ampm = match[3]?.toUpperCase()
      if (ampm === 'PM' && h < 12) h += 12
      if (ampm === 'AM' && h === 12) h = 0
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
    return s
  }

  // Number (Excel serial time, e.g. 0.583333 = 14:00)
  if (typeof value === 'number') {
    const totalMinutes = Math.round(value * 24 * 60)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // Date object
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  }

  return String(value)
}

/** Convert "17:00" or "17:00:00" → "5:00 PM" */
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

// ── Parsed section type used by the upload modal ─────────────────────────────

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

// ── Upload Class List Modal ──────────────────────────────────────────────────

interface UploadModalProps {
  professorId: string
  onClose: () => void
  onComplete: () => void
}

function UploadClassListModal({ professorId, onClose, onComplete }: UploadModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'uploading' | 'done'>('upload')
  const [parsedSections, setParsedSections] = useState<ParsedSection[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [uploadResult, setUploadResult] = useState<any>(null)
  const [progress, setProgress] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Parse XLSX ──────────────────────────────────────────────────────────────

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

        // Col indices (0-based): 2=Class, 5=SubCode, 6=Subject, 8=StudNo,
        // 9=StLName, 10=StFName, 11=StMName, 13=DaysCode, 14=ClassStart,
        // 15=ClassEnd, 16=StudentCourse, 18=Email, 22=SY, 28=Room
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

        // Build a map: sectionCode -> { schedules, students }
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

          // Schedule key = subCode + day + start + end
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

          // Student (deduplicate by student number)
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

        // Convert map to array
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

  // ── Toggle section selection ────────────────────────────────────────────────

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

  // ── Submit to API ───────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (selectedSections.length === 0) return
    setStep('uploading')
    setProgress('Uploading class list...')

    try {
      const payload = {
        professorId,
        sections: selectedSections.map(({ selected, selectedScheduleKeys, ...rest }) => ({
          ...rest,
          schedules: rest.schedules.filter((s) => selectedScheduleKeys.includes(s.schedKey)),
        })),
      }

      const response = await fetch('/api/professor/upload-classlist', {
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

  // ── Search / filter ─────────────────────────────────────────────────────────

  const [searchQuery, setSearchQuery] = useState('')
  const [courseFilter, setCourseFilter] = useState('')
  const [yearLevelFilter, setYearLevelFilter] = useState('')

  // Derive unique courses and year levels for filter dropdowns
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Upload Class List</h2>
              <p className="text-sm text-gray-500">
                {step === 'upload' && 'Select an Excel file (.xlsx) to import sections and students'}
                {step === 'preview' && `${parsedSections.length} sections found — select which ones to import`}
                {step === 'uploading' && 'Creating sections and enrolling students...'}
                {step === 'done' && 'Upload complete'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* ── Step: Upload ───────────────────────────────────────────────── */}
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center py-16">
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
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {parseError}
                </div>
              )}
            </div>
          )}

          {/* ── Step: Preview ──────────────────────────────────────────────── */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span>{filteredSections.length} / {parsedSections.length} sections</span>
                  <span>{filteredSections.reduce((s, sec) => s + sec.students.length, 0)} students</span>
                  <span className="font-medium text-indigo-600">
                    {selectedSections.length} selected
                  </span>
                </div>
                <button
                  onClick={toggleAllFiltered}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {filteredSections.length > 0 && filteredSections.every((s) => s.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {/* Filters row */}
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

              {/* Section list */}
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
                          <div className="text-gray-700 font-medium">
                            {section.students.length} students
                          </div>
                          <div className={`text-xs ${section.selected && section.selectedScheduleKeys.length < section.schedules.length ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                            {section.selected
                              ? `${section.selectedScheduleKeys.length}/${section.schedules.length} subjects`
                              : `${section.schedules.length} subject${section.schedules.length !== 1 ? 's' : ''}`}
                          </div>
                        </div>
                      </div>
                      {/* Expanded schedule checkboxes */}
                      {section.selected && section.schedules.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-indigo-200 space-y-1">
                          <p className="text-xs font-medium text-indigo-700 mb-2">Select subjects to create classrooms for:</p>
                          {section.schedules.map((sched) => {
                            const isSchedSelected = section.selectedScheduleKeys.includes(sched.schedKey)
                            return (
                              <div
                                key={sched.schedKey}
                                onClick={(e) => { e.stopPropagation(); toggleSchedule(section.sectionCode, sched.schedKey) }}
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
                                <span className="text-gray-400 not-italic">—</span>
                                <span>{sched.dayOfWeek} {formatTime12h(sched.startTime)}–{formatTime12h(sched.endTime)}</span>
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

          {/* ── Step: Uploading ────────────────────────────────────────────── */}
          {step === 'uploading' && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-6 text-gray-700 font-medium">{progress}</p>
              <p className="mt-2 text-sm text-gray-500">
                Creating {selectedSections.length} sections and enrolling{' '}
                {selectedSections.reduce((s, sec) => s + sec.students.length, 0)} students...
              </p>
            </div>
          )}

          {/* ── Step: Done ─────────────────────────────────────────────────── */}
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
                      <div className="text-xs text-blue-600 mt-1">Classes Created</div>
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
                          <li key={i}>• {err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-sm text-gray-500 text-center">
                    Students are enrolled without face data. They will need to register their face separately.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
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
                disabled={selectedSections.length === 0}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                Import {selectedSections.length} Section{selectedSections.length !== 1 ? 's' : ''} (
                {selectedSections.reduce((s, sec) => s + sec.students.length, 0)} students)
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
