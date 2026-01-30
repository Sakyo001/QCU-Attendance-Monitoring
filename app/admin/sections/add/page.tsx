'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/utils/supabase/client'

export default function AddSectionPage() {
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    section: '',
    course: 'BSIT',
    semester: '1st',
    yearFrom: new Date().getFullYear(),
    yearTo: new Date().getFullYear() + 1,
    maxStudents: 40,
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      // Create academic year string
      const academicYear = `${formData.yearFrom}-${formData.yearTo}`
      
      // Create section
      const { data: sectionData, error: sectionError } = await supabase
        .from('sections')
        .insert({
          section_code: formData.section,
          semester: formData.semester,
          academic_year: academicYear,
          max_students: formData.maxStudents,
        } as any)
        .select()
        .single()

      if (sectionError) {
        console.error('Section creation error:', sectionError)
        throw new Error(sectionError.message)
      }

      if (sectionData) {
        console.log('Section created successfully:', sectionData.id)
        router.push('/admin/sections')
      } else {
        throw new Error('No section data returned from insert')
      }
    } catch (err: any) {
      console.error('Error creating section:', err)
      setError(err.message || 'Failed to create section')
      setIsSubmitting(false)
    }
  }

  if (!user || user.role !== 'admin') {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/admin/sections')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Create New Section</h1>
              <p className="text-sm text-gray-600 mt-1">Add a new section to the system</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* Section Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Section Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="section" className="block text-sm font-medium text-gray-700 mb-1">
                  Section *
                </label>
                <input
                  type="text"
                  id="section"
                  name="section"
                  value={formData.section}
                  onChange={handleInputChange}
                  placeholder="e.g., 1A, 2B, 3C"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label htmlFor="course" className="block text-sm font-medium text-gray-700 mb-1">
                  Course
                </label>
                <input
                  type="text"
                  id="course"
                  value={formData.course}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
                />
              </div>

              <div>
                <label htmlFor="semester" className="block text-sm font-medium text-gray-700 mb-1">
                  Semester *
                </label>
                <select
                  id="semester"
                  name="semester"
                  value={formData.semester}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="1st">1st Semester</option>
                  <option value="2nd">2nd Semester</option>
                </select>
              </div>

              <div>
                <label htmlFor="maxStudents" className="block text-sm font-medium text-gray-700 mb-1">
                  Max Students *
                </label>
                <input
                  type="number"
                  id="maxStudents"
                  name="maxStudents"
                  value={formData.maxStudents}
                  onChange={handleInputChange}
                  min="1"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label htmlFor="yearFrom" className="block text-sm font-medium text-gray-700 mb-1">
                  Academic Year From
                </label>
                <input
                  type="number"
                  id="yearFrom"
                  name="yearFrom"
                  value={formData.yearFrom}
                  onChange={handleInputChange}
                  placeholder="e.g., 2025"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label htmlFor="yearTo" className="block text-sm font-medium text-gray-700 mb-1">
                  Academic Year To
                </label>
                <input
                  type="number"
                  id="yearTo"
                  name="yearTo"
                  value={formData.yearTo}
                  onChange={handleInputChange}
                  placeholder="e.g., 2026"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => router.push('/admin/sections')}
              className="px-6 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-violet-600 text-white font-medium rounded-lg hover:bg-violet-700 disabled:bg-violet-400 transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Section'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
