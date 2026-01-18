'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Plus, Edit, Trash2, Mail, Phone, ArrowLeft } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface Faculty {
  id: string
  first_name: string
  last_name: string
  email: string
  employee_id: string
  phone: string | null
  department_name: string | null
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
  const [showModal, setShowModal] = useState(false)
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
    setDepartments([
      { id: '1', name: 'IT Department' }
    ])
  }

  const fetchFaculty = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, employee_id, is_active')
        .eq('role', 'professor')
        .order('last_name', { ascending: true })

      if (error) throw error

      const formattedData = data?.map((f: any) => ({
        id: f.id,
        first_name: f.first_name,
        last_name: f.last_name,
        email: f.email,
        employee_id: f.employee_id,
        phone: null,
        is_active: f.is_active,
        department_name: 'IT Department',
      })) || []

      setFaculty(formattedData)
    } catch (error) {
      console.error('Error fetching faculty:', error)
    } finally {
      setLoadingFaculty(false)
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="departmentFilter" className="block text-sm font-medium text-gray-700 mb-2">
                  Department
                </label>
                <select
                  id="departmentFilter"
                  value={filters.departmentId}
                  onChange={(e) => setFilters(prev => ({ ...prev, departmentId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">All Departments</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

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
          ) : faculty.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">No faculty members added yet</p>
              <button
                onClick={() => setShowModal(true)}
                className="mt-4 text-violet-600 hover:text-violet-700 font-medium"
              >
                Add your first faculty member
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
                      Employee ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact
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
                  {faculty.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {member.first_name} {member.last_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.employee_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 text-sm text-gray-900">
                            <Mail className="w-3 h-3 text-gray-400" />
                            {member.email}
                          </div>
                          {member.phone && (
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                              <Phone className="w-3 h-3 text-gray-400" />
                              {member.phone}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.department_name || 'Not assigned'}
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

      {/* Add Faculty Modal - placeholder */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Add Faculty Member</h2>
            <p className="text-gray-600 mb-4">Faculty creation form coming soon...</p>
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
