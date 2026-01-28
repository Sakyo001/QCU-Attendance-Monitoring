'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Plus, Edit, Trash2, Mail, ArrowLeft, UserCheck } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Swal from 'sweetalert2'

interface Student {
  id: string
  first_name: string
  last_name: string
  email: string
  student_id: string
  is_active: boolean
}

export default function StudentsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [students, setStudents] = useState<Student[]>([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      fetchStudents()
    }
  }, [user])

  const fetchStudents = async () => {
    try {
      setLoadingStudents(true)
      const response = await fetch('/api/admin/students')
      if (!response.ok) {
        const error = await response.json()
        console.error('Students fetch error:', error)
        setLoadingStudents(false)
        return
      }

      const data = await response.json()
      console.log('Students fetched:', data?.length || 0, 'members')
      setStudents(data || [])
    } catch (error) {
      console.error('Exception in fetchStudents:', error)
    } finally {
      setLoadingStudents(false)
    }
  }

  const handleEdit = async (student: Student) => {
    const { value: formValues } = await Swal.fire({
      title: 'Edit Student',
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
          <label>First Name</label>
          <input id="first_name" type="text" value="${student.first_name}" />
        </div>
        <div class="edit-input-group">
          <label>Last Name</label>
          <input id="last_name" type="text" value="${student.last_name}" />
        </div>
        <div class="edit-input-group">
          <label>Email</label>
          <input id="email" type="email" value="${student.email}" />
        </div>
        <div class="edit-input-group">
          <label>Student ID</label>
          <input id="student_id" type="text" value="${student.student_id}" />
        </div>
        <div class="edit-input-group">
          <label>Status</label>
          <select id="is_active">
            <option value="true" ${student.is_active ? 'selected' : ''}>Active</option>
            <option value="false" ${!student.is_active ? 'selected' : ''}>Inactive</option>
          </select>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Save',
      confirmButtonColor: '#7c3aed',
      cancelButtonText: 'Cancel',
      allowOutsideClick: false,
      didOpen: () => {
        const input = document.getElementById('first_name') as HTMLInputElement
        if (input) input.focus()
      }
    })

    if (formValues) {
      const firstNameInput = document.getElementById('first_name') as HTMLInputElement
      const lastNameInput = document.getElementById('last_name') as HTMLInputElement
      const emailInput = document.getElementById('email') as HTMLInputElement
      const studentIdInput = document.getElementById('student_id') as HTMLInputElement
      const isActiveInput = document.getElementById('is_active') as HTMLSelectElement

      await handleUpdateStudent(
        student.id,
        firstNameInput.value,
        lastNameInput.value,
        emailInput.value,
        studentIdInput.value,
        isActiveInput.value === 'true'
      )
    }
  }

  const handleDelete = async (student: Student) => {
    const result = await Swal.fire({
      title: 'Delete Student',
      html: `Are you sure you want to delete <strong>${student.first_name} ${student.last_name}</strong>? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#dc2626',
      cancelButtonText: 'Cancel',
      reverseButtons: true
    })

    if (result.isConfirmed) {
      await handleDeleteStudent(student.id)
    }
  }

  const handleUpdateStudent = async (
    studentId: string,
    firstName: string,
    lastName: string,
    email: string,
    studentNumber: string,
    isActive: boolean
  ) => {
    try {
      console.log('🔄 Updating student:', studentId)
      
      const response = await fetch('/api/admin/students/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          firstName,
          lastName,
          email,
          studentNumber,
          isActive
        })
      })

      const result = await response.json()

      if (!response.ok) {
        console.error('❌ Update error:', result)
        throw new Error(result.error || 'Failed to update student')
      }

      console.log('✅ Student updated successfully')

      await Swal.fire({
        title: 'Success!',
        text: 'Student updated successfully',
        icon: 'success',
        confirmButtonColor: '#7c3aed'
      })

      await fetchStudents()
    } catch (error: any) {
      console.error('Error updating student:', error)
      await Swal.fire({
        title: 'Error!',
        text: error.message || 'Failed to update student',
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      })
    }
  }

  const handleDeleteStudent = async (studentId: string) => {
    try {
      console.log('🗑️ Deleting student:', studentId)
      
      const response = await fetch('/api/admin/students/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId })
      })

      const result = await response.json()

      if (!response.ok) {
        console.error('❌ Delete error:', result)
        throw new Error(result.error || 'Failed to delete student')
      }

      console.log('✅ Student deleted successfully from both database and auth')
      
      setStudents(prevStudents => prevStudents.filter(s => s.id !== studentId))

      await Swal.fire({
        title: 'Deleted!',
        text: 'Student deleted successfully',
        icon: 'success',
        confirmButtonColor: '#7c3aed'
      })

      await fetchStudents()
    } catch (error: any) {
      console.error('Error deleting student:', error)
      await Swal.fire({
        title: 'Error!',
        text: error.message || 'Failed to delete student',
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
                <h1 className="text-2xl font-bold text-gray-900">Student Management</h1>
                <p className="text-sm text-gray-600 mt-1">Manage student records and enrollments</p>
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
            <div className="text-sm font-medium text-gray-600">Total Students</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">{students.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Active</div>
            <div className="text-3xl font-bold text-green-600 mt-2">
              {students.filter((s) => s.is_active).length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Face Registered</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">
              {students.length}
            </div>
          </div>
        </div>

        {/* Students Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">All Students</h2>
          </div>

          {loadingStudents ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading students...</p>
            </div>
          ) : students.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">No students added yet</p>
              <button
                onClick={() => setShowModal(true)}
                className="mt-4 text-violet-600 hover:text-violet-700 font-medium"
              >
                Add your first student
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Student ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {students.map((student) => (
                    <tr key={student.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {student.first_name} {student.last_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {student.student_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-sm text-gray-900">
                          <Mail className="w-3 h-3 text-gray-400" />
                          {student.email}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            student.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {student.is_active ? 'Face Registered' : 'Not Registered'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleEdit(student)}
                            className="text-violet-600 hover:text-violet-900 transition-colors"
                            title="Edit student"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDelete(student)}
                            className="text-red-600 hover:text-red-900 transition-colors"
                            title="Delete student"
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

      {/* Add Student Modal - placeholder */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Add Student</h2>
            <p className="text-gray-600 mb-4">Student creation form coming soon...</p>
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
