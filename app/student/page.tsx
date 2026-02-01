'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Calendar, BookOpen, CheckCircle, XCircle, Clock, LogOut } from 'lucide-react'

export default function StudentDashboard() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const [isRegistered, setIsRegistered] = useState(false)
  const [checkingRegistration, setCheckingRegistration] = useState(true)

  useEffect(() => {
    if (!loading && (!user || user.role !== 'student')) {
      router.push('/login')
      return
    }

    if (!loading && user) {
      checkFaceRegistration()
    }
  }, [user, loading, router])

  const checkFaceRegistration = async () => {
    try {
      setCheckingRegistration(true)
      const response = await fetch(`/api/student/face-registration/check?studentId=${user?.id}`)
      const data = await response.json()

      if (data.success) {
        setIsRegistered(data.isRegistered)
        if (!data.isRegistered) {
          // Redirect to face registration if not registered
          router.push('/student/face-registration')
        }
      }
    } catch (error) {
      console.error('Error checking face registration:', error)
    } finally {
      setCheckingRegistration(false)
    }
  }

  if (loading || checkingRegistration) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
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
    router.push('/student/login')
  }

  const stats = [
    { label: 'Enrolled Courses', value: '0', icon: BookOpen, color: 'bg-blue-500' },
    { label: 'Present Days', value: '0', icon: CheckCircle, color: 'bg-green-500' },
    { label: 'Absent Days', value: '0', icon: XCircle, color: 'bg-red-500' },
    { label: 'Attendance Rate', value: '0%', icon: Calendar, color: 'bg-purple-500' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Student Dashboard</h1>
              <p className="text-sm text-gray-600 mt-1">
                Welcome back, {user.firstName} {user.lastName}
              </p>
              <p className="text-sm text-gray-500">Student ID: {user.studentId}</p>
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

        {/* Today's Classes */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Today's Classes</h2>
          </div>
          <div className="p-6">
            <p className="text-gray-600 text-center py-8">No classes scheduled for today</p>
          </div>
        </div>

        {/* Recent Attendance */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Attendance</h2>
          </div>
          <div className="p-6">
            <p className="text-gray-600 text-center py-8">No attendance records yet</p>
          </div>
        </div>
      </main>
    </div>
  )
}
