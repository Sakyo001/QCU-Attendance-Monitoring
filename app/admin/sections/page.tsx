'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Plus, Edit, Trash2, Users, ArrowLeft } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface Section {
  id: string
  section_code: string
  section_name: string
  course_name: string
  course_code: string
  professor_name: string
  term: string
  room: string
  enrolled_students: number
}

interface Course {
  id: string
  course_code: string
  course_name: string
}

interface Professor {
  id: string
  first_name: string
  last_name: string
}

export default function SectionsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [sections, setSections] = useState<Section[]>([])
  const [loadingSections, setLoadingSections] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [courses, setCourses] = useState<Course[]>([])
  const [professors, setProfessors] = useState<Professor[]>([])
  const [filters, setFilters] = useState({
    courseId: '',
    professorId: '',
    term: '',
  })
  const supabase = createClient()

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      fetchSections()
      fetchCourses()
      fetchProfessors()
    }
  }, [user])

  const fetchCourses = async () => {
    try {
      const { data, error } = await supabase
        .from('courses')
        .select('id, course_code, course_name')
        .order('course_code')

      if (!error && data) setCourses(data)
    } catch (error) {
      console.error('Error fetching courses:', error)
    }
  }

  const fetchProfessors = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name')
        .eq('role', 'professor')
        .order('last_name')

      if (!error && data) setProfessors(data)
    } catch (error) {
      console.error('Error fetching professors:', error)
    }
  }

  const fetchSections = async () => {
    try {
      const { data, error } = await supabase
        .from('professor_sections_view')
        .select('*')
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
                <h1 className="text-2xl font-bold text-gray-900">Section Management</h1>
                <p className="text-sm text-gray-600 mt-1">Create and manage class sections</p>
              </div>
            </div>
            <button
              onClick={() => router.push('/admin/sections/add')}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Section
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Total Sections</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">{sections.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Total Students</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {sections.reduce((sum, s) => sum + (s.enrolled_students || 0), 0)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Avg Students/Section</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {sections.length > 0
                ? Math.round(sections.reduce((sum, s) => sum + (s.enrolled_students || 0), 0) / sections.length)
                : 0}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Filter Sections</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="courseFilter" className="block text-sm font-medium text-gray-700 mb-2">
                Course
              </label>
              <select
                id="courseFilter"
                value={filters.courseId}
                onChange={(e) => setFilters(prev => ({ ...prev, courseId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All Courses</option>
                {courses.map(course => (
                  <option key={course.id} value={course.id}>
                    {course.course_code} - {course.course_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="professorFilter" className="block text-sm font-medium text-gray-700 mb-2">
                Professor
              </label>
              <select
                id="professorFilter"
                value={filters.professorId}
                onChange={(e) => setFilters(prev => ({ ...prev, professorId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All Professors</option>
                {professors.map(prof => (
                  <option key={prof.id} value={prof.id}>
                    {prof.first_name} {prof.last_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="termFilter" className="block text-sm font-medium text-gray-700 mb-2">
                Term
              </label>
              <select
                id="termFilter"
                value={filters.term}
                onChange={(e) => setFilters(prev => ({ ...prev, term: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All Terms</option>
                <option value="fall">Fall</option>
                <option value="spring">Spring</option>
                <option value="summer">Summer</option>
              </select>
            </div>
          </div>
        </div>

        {/* Sections Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">All Sections</h2>
          </div>
          
          {loadingSections ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading sections...</p>
            </div>
          ) : sections.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">No sections created yet</p>
              <button
                onClick={() => setShowModal(true)}
                className="mt-4 text-violet-600 hover:text-violet-700 font-medium"
              >
                Create your first section
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Section Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Course
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Professor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Term
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Room
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Students
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sections.map((section) => (
                    <tr key={section.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{section.section_code}</div>
                        <div className="text-sm text-gray-500">{section.section_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{section.course_code}</div>
                        <div className="text-sm text-gray-500">{section.course_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {section.professor_name || 'Not assigned'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                          {section.term}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {section.room || 'TBA'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900">{section.enrolled_students || 0}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <button className="text-violet-600 hover:text-violet-900">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button className="text-red-600 hover:text-red-900">
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

      {/* Create Section Modal - placeholder */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Create New Section</h2>
            <p className="text-gray-600 mb-4">Section creation form coming soon...</p>
            <button
              onClick={() => setShowModal(false)}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
