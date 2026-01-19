'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Users, GraduationCap, BookOpen, BarChart3, Settings, LogOut } from 'lucide-react'

export default function AdminDashboard() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalProfessors: 0,
    totalSections: 0,
    attendanceRate: 0,
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
    { label: 'Total Students', value: stats.totalStudents, icon: Users, color: 'bg-blue-500' },
    { label: 'Total Professors', value: stats.totalProfessors, icon: GraduationCap, color: 'bg-green-500' },
    { label: 'Active Sections', value: stats.totalSections, icon: BookOpen, color: 'bg-purple-500' },
  ]

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {statCards.map((stat) => {
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
              
              <button 
                onClick={() => router.push('/admin/settings')}
                className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-violet-500 hover:bg-violet-50 transition-all"
              >
                <Settings className="w-5 h-5 text-violet-600" />
                <div className="text-left">
                  <div className="font-medium text-gray-900">System Settings</div>
                  <div className="text-sm text-gray-600">Configure system options</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="mt-8 bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          </div>
          <div className="p-6">
            <p className="text-gray-600 text-center py-8">No recent activity to display</p>
          </div>
        </div>
      </main>
    </div>
  )
}
