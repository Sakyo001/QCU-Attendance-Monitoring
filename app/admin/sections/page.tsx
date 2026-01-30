'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Plus, Edit, Trash2, Users, ArrowLeft } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Swal from 'sweetalert2'

interface Section {
  id: string
  section_code: string
  semester: string
  academic_year: string
  max_students: number
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
  const [courses, setCourses] = useState<Course[]>([])
  const [professors, setProfessors] = useState<Professor[]>([])
  const [filters, setFilters] = useState({
    courseId: '',
    professorId: '',
    semester: '',
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
    setCourses([
      { id: '1', course_code: 'BSIT', course_name: 'Bachelor of Science in Information Technology' }
    ])
  }

  const fetchProfessors = async () => {
    try {
      console.log('Starting to fetch professors via API...')
      
      // Use server endpoint to bypass RLS
      const response = await fetch('/api/admin/professors')
      
      if (!response.ok) {
        const errorData = await response.json()
        console.error('Error fetching professors:', errorData)
        return
      }

      const data = await response.json()
      console.log('Professors fetched from API:', data)
      console.log('Data length:', data?.length)
      
      if (data && data.length > 0) {
        setProfessors(data)
        console.log('Professors set to state:', data)
      } else {
        console.warn('No professors found in database')
      }
    } catch (error) {
      console.error('Exception in fetchProfessors:', error)
    }
  }

  const fetchSections = async () => {
    try {
      const { data, error } = await supabase
        .from('sections')
        .select('id, section_code, semester, academic_year, max_students')
        .order('section_code', { ascending: true })

      if (error) throw error

      setSections((data as any) || [])
    } catch (error) {
      console.error('Error fetching sections:', error)
    } finally {
      setLoadingSections(false)
    }
  }

  const getFilteredSections = () => {
    return sections.filter(section => {
      if (filters.semester && section.semester !== filters.semester) {
        return false
      }
      return true
    })
  }

  const handleEdit = async (section: Section) => {
    const { value: formValues } = await Swal.fire({
      title: 'Edit Section',
      html: `
        <style>
          .edit-input-group { text-align: left; margin-bottom: 12px; }
          .edit-input-group label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; font-weight: 500; }
          .edit-input-group input,
          .edit-input-group select { 
            width: 100%; 
            padding: 8px 10px; 
            border: 1px solid #ddd; 
            border-radius: 4px; 
            font-size: 14px;
            box-sizing: border-box;
          }
          .edit-input-group input:focus,
          .edit-input-group select:focus { 
            outline: none; 
            border-color: #7c3aed; 
            box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.1);
          }
        </style>
        <div class="edit-input-group">
          <label>Section Code</label>
          <input id="section_code" type="text" value="${section.section_code}" />
        </div>
        <div class="edit-input-group">
          <label>Semester</label>
          <select id="semester">
            <option value="1st" ${section.semester === '1st' ? 'selected' : ''}>1st Semester</option>
            <option value="2nd" ${section.semester === '2nd' ? 'selected' : ''}>2nd Semester</option>
          </select>
        </div>
        <div class="edit-input-group">
          <label>Academic Year</label>
          <input id="academic_year" type="text" value="${section.academic_year}" placeholder="2024-2025" />
        </div>
        <div class="edit-input-group">
          <label>Max Students</label>
          <input id="max_students" type="number" value="${section.max_students}" min="1" />
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Save',
      confirmButtonColor: '#7c3aed',
      cancelButtonText: 'Cancel',
      allowOutsideClick: false,
      didOpen: () => {
        const input = document.getElementById('section_code') as HTMLInputElement
        if (input) input.focus()
      }
    })

    if (formValues) {
      const sectionCodeInput = document.getElementById('section_code') as HTMLInputElement
      const semesterInput = document.getElementById('semester') as HTMLSelectElement
      const academicYearInput = document.getElementById('academic_year') as HTMLInputElement
      const maxStudentsInput = document.getElementById('max_students') as HTMLInputElement

      await handleUpdateSection(
        section.id,
        sectionCodeInput.value,
        semesterInput.value,
        academicYearInput.value,
        parseInt(maxStudentsInput.value)
      )
    }
  }

  const handleDelete = async (section: Section) => {
    const result = await Swal.fire({
      title: 'Delete Section',
      html: `Are you sure you want to delete section <strong>${section.section_code}</strong>? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete Section',
      confirmButtonColor: '#dc2626',
      cancelButtonText: 'Cancel',
      reverseButtons: true
    })

    if (result.isConfirmed) {
      await handleDeleteSection(section.id)
    }
  }

  const handleUpdateSection = async (
    sectionId: string,
    sectionCode: string,
    semester: string,
    academicYear: string,
    maxStudents: number
  ) => {
    try {
      const { error } = await (supabase as any)
        .from('sections')
        .update({
          section_code: sectionCode,
          semester: semester,
          academic_year: academicYear,
          max_students: maxStudents
        } as any)
        .eq('id', sectionId as any)

      if (error) throw error

      await Swal.fire({
        title: 'Success!',
        text: 'Section updated successfully',
        icon: 'success',
        confirmButtonColor: '#7c3aed'
      })

      // Refresh sections
      await fetchSections()
    } catch (error) {
      console.error('Error updating section:', error)
      await Swal.fire({
        title: 'Error!',
        text: 'Failed to update section',
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      })
    }
  }

  const handleDeleteSection = async (sectionId: string) => {
    try {
      const { error } = await supabase
        .from('sections')
        .delete()
        .eq('id', sectionId as any)

      if (error) throw error

      await Swal.fire({
        title: 'Deleted!',
        text: 'Section deleted successfully',
        icon: 'success',
        confirmButtonColor: '#7c3aed'
      })

      // Refresh sections
      await fetchSections()
    } catch (error) {
      console.error('Error deleting section:', error)
      await Swal.fire({
        title: 'Error!',
        text: 'Failed to delete section',
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      })
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
            <div className="text-3xl font-bold text-gray-900 mt-2">{getFilteredSections().length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Total Capacity</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {getFilteredSections().reduce((sum, s) => sum + (s.max_students || 0), 0)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Avg Capacity/Section</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {getFilteredSections().length > 0
                ? Math.round(getFilteredSections().reduce((sum, s) => sum + (s.max_students || 0), 0) / getFilteredSections().length)
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
              <label htmlFor="semesterFilter" className="block text-sm font-medium text-gray-700 mb-2">
                Semester
              </label>
              <select
                id="semesterFilter"
                value={filters.semester}
                onChange={(e) => setFilters(prev => ({ ...prev, semester: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All Semesters</option>
                <option value="1st">1st Semester</option>
                <option value="2nd">2nd Semester</option>
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
                onClick={() => router.push('/admin/sections/add')}
                className="mt-4 text-violet-600 hover:text-violet-700 font-medium"
              >
                Create your first section
              </button>
            </div>
          ) : getFilteredSections().length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">No sections match the selected filters</p>
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
                      Semester
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Academic Year
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Max Students
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getFilteredSections().map((section) => (
                    <tr key={section.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {section.section_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        BSIT
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                          {section.semester}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {section.academic_year}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900">{section.max_students}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleEdit(section)}
                            className="text-violet-600 hover:text-violet-900 transition-colors"
                            title="Edit section"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDelete(section)}
                            className="text-red-600 hover:text-red-900 transition-colors"
                            title="Delete section"
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
    </div>
  )
}
