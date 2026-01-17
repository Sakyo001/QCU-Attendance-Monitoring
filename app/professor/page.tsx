'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BookOpen, Users, Calendar, LogOut, Clock, MapPin, Play } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface Schedule {
  id: string
  day_of_week: string
  start_time: string
  end_time: string
  room: string
}

interface Section {
  id: string
  section_name: string
  course_code: string
  course_name: string
  room: string
  enrolled_count: number
  schedules: Schedule[]
}

export default function ProfessorDashboard() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  
  const [sections, setSections] = useState<Section[]>([])
  const [loadingSections, setLoadingSections] = useState(true)
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
    console.log('Fetching sections for user:', user?.id, user?.email)
    setLoadingSections(true)
    
    try {
      if (!user?.id) {
        console.warn('No user ID available, skipping fetch')
        setLoadingSections(false)
        return
      }

      console.log('Querying sections with professor_id:', user.id)

      // Get professor's sections using database user ID
      const query = supabase
        .from('sections')
        .select(`
          id,
          section_name,
          room,
          professor_id,
          courses (
            id,
            course_code,
            course_name
          ),
          enrollments (id),
          section_schedules (
            id,
            day_of_week,
            start_time,
            end_time,
            room
          )
        `)
        .eq('professor_id', user.id)

      const { data: sectionsData, error } = await query

      if (error) {
        console.error('Full error object:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        })
        console.error('Error fetching sections:', error)
        setLoadingSections(false)
        return
      }

      console.log('Sections data received:', sectionsData?.length || 0, 'sections')
      console.log('Raw sections data:', sectionsData)

      const formattedSections: Section[] = (sectionsData || []).map((section: any) => {
        const enrollments = Array.isArray(section.enrollments) ? section.enrollments : []
        return {
          id: section.id,
          section_name: section.section_name,
          course_code: section.courses?.course_code || 'N/A',
          course_name: section.courses?.course_name || 'N/A',
          room: section.room || 'TBA',
          enrolled_count: enrollments.length,
          schedules: section.section_schedules || [],
        }
      })

      console.log('Formatted sections:', formattedSections)
      setSections(formattedSections)

      // Count today's classes
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })
      const todayCount = formattedSections.reduce((count, section) => {
        return count + section.schedules.filter(s => s.day_of_week === today).length
      }, 0)
      setTodayClasses(todayCount)

    } catch (error: any) {
      console.error('Exception in fetchSections:', error)
      console.error('Error message:', error?.message)
      console.error('Error stack:', error?.stack)
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
    router.push(`/professor/attendance/${sectionId}?schedule=${scheduleId}`)
  }

  const totalStudents = sections.reduce((sum, section) => sum + section.enrolled_count, 0)
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  const stats = [
    { label: 'My Sections', value: sections.length.toString(), icon: BookOpen, color: 'bg-emerald-500' },
    { label: 'Total Students', value: totalStudents.toString(), icon: Users, color: 'bg-blue-500' },
    { label: 'Classes Today', value: todayClasses.toString(), icon: Calendar, color: 'bg-purple-500' },
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
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">My Assigned Classes</h2>
            <p className="text-sm text-gray-600 mt-1">Select a class session to start attendance</p>
          </div>
          <div className="p-6">
            {sections.length === 0 ? (
              <div className="text-center py-12">
                <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No sections assigned yet</p>
              </div>
            ) : (
              <div className="space-y-6">
                {sections.map((section) => (
                  <div key={section.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* Section Header */}
                    <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{section.section_name}</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            {section.course_code} - {section.course_name}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            <span>{section.enrolled_count} students</span>
                          </div>
                          {section.room && (
                            <div className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              <span>{section.room}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Schedules */}
                    <div className="p-6">
                      {section.schedules.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">No schedule set</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {section.schedules.map((schedule) => {
                            const isToday = schedule.day_of_week === today
                            return (
                              <div
                                key={schedule.id}
                                className={`p-4 border rounded-lg ${
                                  isToday
                                    ? 'border-emerald-300 bg-emerald-50'
                                    : 'border-gray-200 bg-white'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-3">
                                  <span className={`text-sm font-medium ${
                                    isToday ? 'text-emerald-700' : 'text-gray-700'
                                  }`}>
                                    {schedule.day_of_week}
                                  </span>
                                  {isToday && (
                                    <span className="px-2 py-1 text-xs font-semibold bg-emerald-600 text-white rounded">
                                      TODAY
                                    </span>
                                  )}
                                </div>
                                <div className="space-y-2 mb-4">
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Clock className="w-4 h-4" />
                                    <span>{schedule.start_time} - {schedule.end_time}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <MapPin className="w-4 h-4" />
                                    <span>{schedule.room || 'TBA'}</span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleStartSession(section.id, schedule.id)}
                                  className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                                    isToday
                                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                  }`}
                                >
                                  <Play className="w-4 h-4" />
                                  Start Attendance
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
