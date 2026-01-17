'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Users, Calendar, BarChart3, ArrowLeft, Eye } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface Section {
  id: string
  section_code: string
  section_name: string
  course_name: string
  course_code: string
  term: string
  room: string
  enrolled_students: number
  year_label: string
}

export default function ProfessorSectionsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [sections, setSections] = useState<Section[]>([])
  const [loadingSections, setLoadingSections] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (!loading && (!user || user.role !== 'professor')) {
      router.push('/professor/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      fetchMySections()
    }
  }, [user])

  const fetchMySections = async () => {
    try {
      // Fetch sections where this professor is assigned
      const { data, error } = await supabase
        .from('professor_sections_view')
        .select('*')
        .eq('professor_id', user?.id)
        .order('section_code', { ascending: true })

      if (error) throw error

      setSections(data || [])
    } catch (error) {
      console.error('Error fetching sections:', error)
    } finally {
      setLoadingSections(false)
    }
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
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
                onClick={() => router.push('/professor/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">My Sections</h1>
                <p className="text-sm text-gray-600 mt-1">View and monitor your assigned sections</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-600">My Sections</div>
                <div className="text-3xl font-bold text-gray-900 mt-2">{sections.length}</div>
              </div>
              <div className="bg-emerald-500 p-3 rounded-lg">
                <Calendar className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-600">Total Students</div>
                <div className="text-3xl font-bold text-gray-900 mt-2">
                  {sections.reduce((sum, s) => sum + (s.enrolled_students || 0), 0)}
                </div>
              </div>
              <div className="bg-blue-500 p-3 rounded-lg">
                <Users className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-600">Avg Students</div>
                <div className="text-3xl font-bold text-gray-900 mt-2">
                  {sections.length > 0
                    ? Math.round(sections.reduce((sum, s) => sum + (s.enrolled_students || 0), 0) / sections.length)
                    : 0}
                </div>
              </div>
              <div className="bg-purple-500 p-3 rounded-lg">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        </div>

        {/* Sections List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Assigned Sections</h2>
          </div>

          {loadingSections ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading sections...</p>
            </div>
          ) : sections.length === 0 ? (
            <div className="p-8 text-center">
              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">No sections assigned yet</p>
              <p className="text-sm text-gray-500 mt-2">Contact the administrator to assign sections</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {sections.map((section) => (
                <div key={section.id} className="p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {section.course_code} - {section.section_code}
                        </h3>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800">
                          {section.term}
                        </span>
                      </div>
                      <p className="text-gray-600 mb-3">{section.course_name}</p>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div className="flex items-center gap-2 text-gray-600">
                          <Users className="w-4 h-4" />
                          <span>{section.enrolled_students || 0} students</span>
                        </div>
                        <div className="text-gray-600">
                          Room: {section.room || 'TBA'}
                        </div>
                        <div className="text-gray-600">
                          A.Y. {section.year_label}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => router.push(`/professor/sections/${section.id}`)}
                      className="flex items-center gap-2 px-4 py-2 text-emerald-600 border border-emerald-600 rounded-lg hover:bg-emerald-50 transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
