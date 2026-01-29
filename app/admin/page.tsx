'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Users, GraduationCap, BookOpen, BarChart3, LogOut, TrendingUp, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'

interface DashboardStats {
  totalStudents: number
  totalProfessors: number
  totalSections: number
  registeredStudents: number
  totalAttendanceRecords: number
  overallAttendanceRate: number
  today: {
    total: number
    present: number
    absent: number
    late: number
    attendanceRate: number
  }
  recentActivity: Array<{
    id: string
    studentName: string
    studentNumber: string
    status: string
    timestamp: string
    section: string
  }>
}

export default function AdminDashboard() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    totalProfessors: 0,
    totalSections: 0,
    registeredStudents: 0,
    totalAttendanceRecords: 0,
    overallAttendanceRate: 0,
    today: {
      total: 0,
      present: 0,
      absent: 0,
      late: 0,
      attendanceRate: 0
    },
    recentActivity: []
  })
  const [loadingStats, setLoadingStats] = useState(true)

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      fetchStats()
    }
  }, [user])

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/admin/dashboard/stats')
      if (!response.ok) {
        console.error('Stats fetch error')
        setLoadingStats(false)
        return
      }

      const data = await response.json()
      setStats(data)
      console.log('Dashboard stats fetched:', data)
    } catch (error) {
      console.error('Exception in fetchStats:', error)
    } finally {
      setLoadingStats(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
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
    router.push('/admin/login')
  }

  const statCards = [
    { 
      label: 'Total Students', 
      value: stats.totalStudents, 
      icon: Users, 
      color: 'bg-blue-500',
      subtext: `${stats.registeredStudents} registered`
    },
    { 
      label: 'Total Professors', 
      value: stats.totalProfessors, 
      icon: GraduationCap, 
      color: 'bg-green-500',
      subtext: 'Active faculty'
    },
    { 
      label: 'Active Sections', 
      value: stats.totalSections, 
      icon: BookOpen, 
      color: 'bg-purple-500',
      subtext: 'Class sections'
    },
    { 
      label: 'Overall Attendance', 
      value: `${stats.overallAttendanceRate.toFixed(1)}%`, 
      icon: TrendingUp, 
      color: 'bg-violet-500',
      subtext: `${stats.totalAttendanceRecords} total records`
    },
  ]

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'present':
        return <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">Present</span>
      case 'absent':
        return <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">Absent</span>
      case 'late':
        return <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">Late</span>
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs font-medium rounded-full">{status}</span>
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((stat) => {
            const Icon = stat.icon
            return (
              <div key={stat.label} className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className={`${stat.color} p-3 rounded-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
                <p className="text-xs text-gray-500 mt-2">{stat.subtext}</p>
              </div>
            )
          })}
        </div>

        {/* Today's Attendance Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <Clock className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">Today's Summary</h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total Records</span>
                <span className="text-lg font-bold text-gray-900">{stats.today.total}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Attendance Rate</span>
                <span className="text-lg font-bold text-violet-600">{stats.today.attendanceRate.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-semibold text-gray-900">Present Today</h3>
            </div>
            <div className="text-4xl font-bold text-green-600">{stats.today.present}</div>
            <p className="text-sm text-gray-500 mt-2">Students marked present</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-5 h-5 text-yellow-600" />
              <h3 className="text-lg font-semibold text-gray-900">Absent & Late</h3>
            </div>
            <div className="flex items-center gap-4">
              <div>
                <div className="text-2xl font-bold text-red-600">{stats.today.absent}</div>
                <p className="text-xs text-gray-500">Absent</p>
              </div>
              <div className="w-px h-12 bg-gray-200"></div>
              <div>
                <div className="text-2xl font-bold text-yellow-600">{stats.today.late}</div>
                <p className="text-xs text-gray-500">Late</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <button 
                onClick={() => router.push('/admin/faculty')}
                className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-violet-500 hover:bg-violet-50 transition-all"
              >
                <Users className="w-5 h-5 text-violet-600" />
                <div className="text-left">
                  <div className="font-medium text-gray-900">Manage Faculty</div>
                  <div className="text-sm text-gray-600">Add or edit professors</div>
                </div>
              </button>
              
              <button 
                onClick={() => router.push('/admin/students')}
                className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-violet-500 hover:bg-violet-50 transition-all"
              >
                <GraduationCap className="w-5 h-5 text-violet-600" />
                <div className="text-left">
                  <div className="font-medium text-gray-900">Manage Students</div>
                  <div className="text-sm text-gray-600">Add or edit students</div>
                </div>
              </button>
              
              <button 
                onClick={() => router.push('/admin/sections')}
                className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-violet-500 hover:bg-violet-50 transition-all"
              >
                <BookOpen className="w-5 h-5 text-violet-600" />
                <div className="text-left">
                  <div className="font-medium text-gray-900">Manage Sections</div>
                  <div className="text-sm text-gray-600">Create or edit class sections</div>
                </div>
              </button>
              
              <button 
                onClick={() => router.push('/admin/reports')}
                className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-violet-500 hover:bg-violet-50 transition-all"
              >
                <BarChart3 className="w-5 h-5 text-violet-600" />
                <div className="text-left">
                  <div className="font-medium text-gray-900">View Reports</div>
                  <div className="text-sm text-gray-600">Attendance analytics</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="mt-8 bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Attendance Activity</h2>
          </div>
          <div className="overflow-x-auto">
            {stats.recentActivity.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-600">No recent activity to display</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Student
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Student Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Section
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {stats.recentActivity.map((activity) => (
                    <tr key={activity.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{activity.studentName}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {activity.studentNumber}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {activity.section}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(activity.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        <div>{formatDate(activity.timestamp)}</div>
                        <div className="text-xs text-gray-500">{formatTime(activity.timestamp)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
