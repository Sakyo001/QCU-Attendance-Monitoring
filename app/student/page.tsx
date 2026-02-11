'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Camera, UserCheck, Info, LogOut, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function StudentPage() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && (!user || user.role !== 'student')) {
      router.push('/login')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return null

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 hover:bg-gray-100 rounded-lg transition">
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </Link>
            <div>
              <h1 className="text-lg font-bold text-gray-900">VeriFace Student</h1>
              <p className="text-sm text-gray-500">Welcome, {user.firstName} {user.lastName}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg w-full text-center space-y-8">
          {/* Icon */}
          <div className="mx-auto w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center">
            <Camera className="w-12 h-12 text-emerald-600" />
          </div>

          {/* Title */}
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Automatic Attendance</h2>
            <p className="text-gray-600 text-lg leading-relaxed">
              Your attendance is now recorded automatically through facial recognition. 
              Simply step in front of the classroom kiosk — no manual sign-in needed.
            </p>
          </div>

          {/* Info Cards */}
          <div className="space-y-4 text-left">
            <div className="bg-white rounded-xl p-5 border shadow-sm flex items-start gap-4">
              <div className="bg-blue-100 p-2 rounded-lg shrink-0">
                <Camera className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">How It Works</h3>
                <p className="text-sm text-gray-600 mt-1">
                  When you enter the classroom, the kiosk camera will automatically detect and recognize your face. 
                  Your attendance is recorded instantly — present if within 30 minutes of class start, or late after that.
                </p>
              </div>
            </div>
            
            <div className="bg-white rounded-xl p-5 border shadow-sm flex items-start gap-4">
              <div className="bg-amber-100 p-2 rounded-lg shrink-0">
                <Info className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Attendance Summary</h3>
                <p className="text-sm text-gray-600 mt-1">
                  To view your attendance summary, please request it directly from your professor. 
                  Professors have access to detailed daily reports showing your present, late, and absent records.
                </p>
              </div>
            </div>
            
            <div className="bg-white rounded-xl p-5 border shadow-sm flex items-start gap-4">
              <div className="bg-emerald-100 p-2 rounded-lg shrink-0">
                <UserCheck className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Face Registration</h3>
                <p className="text-sm text-gray-600 mt-1">
                  If you haven&apos;t registered your face yet, ask your professor to register you 
                  through the classroom session panel. This only needs to be done once.
                </p>
              </div>
            </div>
          </div>

          {/* Student ID */}
          {user.studentId && (
            <div className="bg-gray-800 text-white px-6 py-3 rounded-xl inline-block">
              <p className="text-xs text-gray-400">Student ID</p>
              <p className="text-lg font-mono font-bold">{user.studentId}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
