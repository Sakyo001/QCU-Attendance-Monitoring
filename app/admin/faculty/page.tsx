'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Plus, Edit, Trash2, ArrowLeft } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import Swal from 'sweetalert2'

interface Faculty {
  id: string
  first_name: string
  last_name: string
  email: string
  employee_id: string
  is_active: boolean
}

interface Department {
  id: string
  name: string
}

export default function FacultyPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [faculty, setFaculty] = useState<Faculty[]>([])
  const [loadingFaculty, setLoadingFaculty] = useState(true)
  const [departments, setDepartments] = useState<Department[]>([])
  const [filters, setFilters] = useState({
    departmentId: '',
    status: '',
  })
  const supabase = createClient()

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      fetchFaculty()
      fetchDepartments()
    }
  }, [user])

  const fetchDepartments = async () => {
    // Set static departments - no table exists
    setDepartments([
      { id: '1', name: 'IT Department' }
    ])
  }

  const fetchFaculty = async () => {
    try {
      setLoadingFaculty(true)
      const response = await fetch('/api/admin/faculty')
      if (!response.ok) {
        const error = await response.json()
        console.error('Faculty fetch error:', error)
        setLoadingFaculty(false)
        return
      }

      const data = await response.json()
      console.log('Faculty fetched:', data?.length || 0, 'members')
      setFaculty(data || [])
    } catch (error) {
      console.error('Exception in fetchFaculty:', error)
    } finally {
      setLoadingFaculty(false)
    }
  }

  const getFilteredFaculty = () => {
    return faculty.filter(member => {
      if (filters.status === 'active' && !member.is_active) {
        return false
      }
      if (filters.status === 'inactive' && member.is_active) {
        return false
      }
      return true
    })
  }

  const handleEdit = async (member: Faculty) => {
    const { value: formValues } = await Swal.fire({
      title: 'Edit Faculty',
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
          <input id="first_name" type="text" value="${member.first_name}" />
        </div>
        <div class="edit-input-group">
          <label>Last Name</label>
          <input id="last_name" type="text" value="${member.last_name}" />
        </div>
        <div class="edit-input-group">
          <label>Email</label>
          <input id="email" type="email" value="${member.email}" />
        </div>
        <div class="edit-input-group">
          <label>Employee ID</label>
          <input id="employee_id" type="text" value="${member.employee_id}" />
        </div>
        <div class="edit-input-group">
          <label>Status</label>
          <select id="is_active">
            <option value="true" ${member.is_active ? 'selected' : ''}>Active</option>
            <option value="false" ${!member.is_active ? 'selected' : ''}>Inactive</option>
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
      const employeeIdInput = document.getElementById('employee_id') as HTMLInputElement
      const isActiveInput = document.getElementById('is_active') as HTMLSelectElement

      await handleUpdateFaculty(
        member.id,
        firstNameInput.value,
        lastNameInput.value,
        emailInput.value,
        employeeIdInput.value,
        isActiveInput.value === 'true'
      )
    }
  }

  const handleDelete = async (member: Faculty) => {
    const result = await Swal.fire({
      title: 'Delete Faculty',
      html: `Are you sure you want to delete <strong>${member.first_name} ${member.last_name}</strong>? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#dc2626',
      cancelButtonText: 'Cancel',
      reverseButtons: true
    })

    if (result.isConfirmed) {
      await handleDeleteFaculty(member.id)
    }
  }

  const handleUpdateFaculty = async (
    facultyId: string,
    firstName: string,
    lastName: string,
    email: string,
    employeeId: string,
    isActive: boolean
  ) => {
    try {
      console.log('🔄 Updating faculty:', facultyId)
      
      // Call the API endpoint to update
      const response = await fetch('/api/admin/faculty/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facultyId,
          firstName,
          lastName,
          email,
          employeeId,
          isActive
        })
      })

      const result = await response.json()

      if (!response.ok) {
        console.error('❌ Update error:', result)
        throw new Error(result.error || 'Failed to update faculty member')
      }

      console.log('✅ Faculty updated successfully')

      await Swal.fire({
        title: 'Success!',
        text: 'Faculty member updated successfully',
        icon: 'success',
        confirmButtonColor: '#7c3aed'
      })

      // Refresh the faculty list
      await fetchFaculty()
    } catch (error: any) {
      console.error('Error updating faculty:', error)
      await Swal.fire({
        title: 'Error!',
        text: error.message || 'Failed to update faculty member',
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      })
    }
  }

  const handleDeleteFaculty = async (facultyId: string) => {
    try {
      console.log('🗑️ Deleting faculty:', facultyId)
      
      // Call the API endpoint to delete both from users and auth
      const response = await fetch('/api/admin/faculty/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId })
      })

      const result = await response.json()

      if (!response.ok) {
        console.error('❌ Delete error:', result)
        throw new Error(result.error || 'Failed to delete faculty member')
      }

      console.log('✅ Faculty deleted successfully from both database and auth')
      
      // Immediately update state to remove the deleted faculty
      setFaculty(prevFaculty => prevFaculty.filter(f => f.id !== facultyId))

      await Swal.fire({
        title: 'Deleted!',
        text: 'Faculty member deleted successfully',
        icon: 'success',
        confirmButtonColor: '#7c3aed'
      })

      // Then fetch fresh list from server
      console.log('🔄 Fetching updated faculty list...')
      await fetchFaculty()
    } catch (error: any) {
      console.error('Error deleting faculty:', error)
      await Swal.fire({
        title: 'Error!',
        text: error.message || 'Failed to delete faculty member',
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
                <h1 className="text-2xl font-bold text-gray-900">Faculty Management</h1>
                <p className="text-sm text-gray-600 mt-1">Manage professors and advisers</p>
              </div>
            </div>
            <button
              onClick={() => router.push('/admin/faculty/add')}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Faculty
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Total Faculty</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">{faculty.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Active</div>
            <div className="text-3xl font-bold text-green-600 mt-2">
              {faculty.filter((f) => f.is_active).length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Inactive</div>
            <div className="text-3xl font-bold text-red-600 mt-2">
              {faculty.filter((f) => !f.is_active).length}
            </div>
          </div>
        </div>

        {/* Faculty Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">All Faculty Members</h2>
            
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
              <div>
                <label htmlFor="statusFilter" className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <select
                  id="statusFilter"
                  value={filters.status}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          {loadingFaculty ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading faculty...</p>
            </div>
          ) : getFilteredFaculty().length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">No faculty members match the selected filters</p>
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
                      Employee ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Department
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
                  {getFilteredFaculty().map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {member.first_name} {member.last_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.employee_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        IT Department
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            member.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {member.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleEdit(member)}
                            className="text-violet-600 hover:text-violet-900 transition-colors"
                            title="Edit faculty"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDelete(member)}
                            className="text-red-600 hover:text-red-900 transition-colors"
                            title="Delete faculty"
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
