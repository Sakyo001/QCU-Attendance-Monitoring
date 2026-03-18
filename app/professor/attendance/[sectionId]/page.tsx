'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { ArrowLeft, Loader2, Camera, RefreshCw, Check, X, ShieldCheck, Clock, Users, Plus, LayoutGrid, List, Monitor, Edit2, Trash2, ScanFace, CircleAlert, CircleCheck, FileText, User } from 'lucide-react'
import { checkFaceNetHealth, ServerCameraStream } from '@/lib/facenet-python-api'
import type { CameraStreamFrame, FaceNetEmbedding } from '@/lib/facenet-python-api'
import { usePassiveLivenessDetection } from '@/hooks/usePassiveLivenessDetection'
import { EditFaceModal } from './edit-face-modal'

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface FaceRegistration {
  id: string
  first_name: string
  last_name: string
  registered_at: string
  is_active: boolean
}

interface AttendanceSession {
  id: string
  is_active: boolean
  shift_opened_at: string | null
  shift_closed_at: string | null
  session_date: string
}

export default function AttendancePage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const sectionId = params.sectionId as string
  const entryMethod = searchParams.get('entryMethod') || 'face' // Default to face if not specified

  const [checkingRegistration, setCheckingRegistration] = useState(true)
  const [isRegistered, setIsRegistered] = useState(false)
  const [faceVerified, setFaceVerified] = useState(false) // Always require verification, will be set true after successful verification
  const [passwordVerified, setPasswordVerified] = useState(false) // Will be set true after successful password verification
  const [showStudentRegModal, setShowStudentRegModal] = useState(false)
  const [showFaceRecognitionModal, setShowFaceRecognitionModal] = useState(false)
  const [showFaceVerificationModal, setShowFaceVerificationModal] = useState(false)
  const [mergedAttendanceData, setMergedAttendanceData] = useState<any[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [viewMode, setViewMode] = useState<'list' | 'seat-plan'>('list')
  const [activeTab, setActiveTab] = useState<'attendance' | 'faces'>('attendance') // Tab state
  const [newStudentNotification, setNewStudentNotification] = useState<string | null>(null)
  const [registeredStudents, setRegisteredStudents] = useState<any[]>([])
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null)
  const [showFaceEditModal, setShowFaceEditModal] = useState(false)
  const [passwordTokenChecked, setPasswordTokenChecked] = useState(false) // Flag to prevent multiple checks

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'professor' && (user.role as any) !== 'adviser'))) {
      router.push('/professor/login')
      return
    }

    if (!loading && user) {
      // Only check face registration if using face entry method
      if (entryMethod === 'face') {
        checkFaceRegistration()
      } else if (entryMethod === 'password') {
        // Password token will be checked in separate useEffect to ensure client-side only
        setCheckingRegistration(false)
      } else {
        // Unknown entry method, default to face
        setCheckingRegistration(false)
      }
      fetchTodayAttendanceRecords()
    }
  }, [user, loading, router, entryMethod, sectionId])

  // Separate effect to verify password token (client-side only)
  useEffect(() => {
    // Skip if already checked or not on password entry method
    if (passwordTokenChecked || entryMethod !== 'password' || typeof window === 'undefined') return

    const storageKey = `password-verified-${sectionId}`
    const storedToken = localStorage.getItem(storageKey)
    console.log('🔐 Password token validation:')
    console.log('  - Section ID:', sectionId)
    console.log('  - Storage key:', storageKey)
    console.log('  - Stored token:', storedToken)
    console.log('  - Token exists:', !!storedToken)
    
    // Mark as checked FIRST to prevent multiple checks
    setPasswordTokenChecked(true)
    
    if (storedToken) {
      // Check if token is valid (not expired - valid for 2 hours)
      const tokenTimestamp = parseInt(storedToken)
      const currentTime = Date.now()
      const tokenAgeMinutes = (currentTime - tokenTimestamp) / (1000 * 60)
      const tokenValidDurationMinutes = 120 // 2 hours
      
      console.log(`⏱️ Token age: ${tokenAgeMinutes.toFixed(2)} minutes (valid for ${tokenValidDurationMinutes} minutes)`)
      
      if (tokenAgeMinutes < tokenValidDurationMinutes) {
        // Valid token, mark as password verified
        console.log('✅ Token validated successfully - within expiration window')
        setPasswordVerified(true)
        setFaceVerified(true) // Allow access
        // Keep the token in storage - don't clear it, user can navigate and come back
      } else {
        // Token expired
        console.error('❌ Password verification token has expired')
        console.error(`   Token is ${tokenAgeMinutes.toFixed(2)} minutes old (max: ${tokenValidDurationMinutes} minutes)`)
        localStorage.removeItem(storageKey)
        router.push('/professor')
      }
    } else {
      // Invalid or missing token, redirect back
      console.error('❌ Invalid or missing password verification token')
      console.error('   Please use the password verification modal to access this page')
      router.push('/professor')
    }
  }, [passwordTokenChecked, entryMethod, sectionId, router])

  // Check Python FaceNet server health
  useEffect(() => {
    const checkServer = async () => {
      const healthy = await checkFaceNetHealth()
      if (!healthy) {
        console.warn('⚠️ Python FaceNet server not responding. Start: python facenet-fast-server.py')
      } else {
        console.log('✅ Python FaceNet server is healthy')
      }
    }
    checkServer()
  }, [])

  // Listen for student registration events to auto-refresh attendance list
  useEffect(() => {
    const handleStudentRegistered = (event: CustomEvent) => {
      console.log('📢 Student registered event received:', event.detail)
      const { firstName, lastName } = event.detail
      
      // Show notification
      setNewStudentNotification(`${firstName} ${lastName} has been registered!`)
      setTimeout(() => setNewStudentNotification(null), 5000)
      
      // Automatically refresh the attendance records to include the new student
      fetchTodayAttendanceRecords()
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'last-student-registration') {
        console.log('📢 Student registration detected via storage event')
        const data = event.newValue ? JSON.parse(event.newValue) : null
        if (data) {
          setNewStudentNotification(`${data.firstName} ${data.lastName} has been registered!`)
          setTimeout(() => setNewStudentNotification(null), 5000)
        }
        // Refresh attendance records when registration happens in another tab
        fetchTodayAttendanceRecords()
      }
    }

    // Add event listeners
    window.addEventListener('student-registered', handleStudentRegistered as EventListener)
    window.addEventListener('storage', handleStorageChange)

    // Cleanup
    return () => {
      window.removeEventListener('student-registered', handleStudentRegistered as EventListener)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [sectionId])

  const checkFaceRegistration = async () => {
    try {
      setCheckingRegistration(true)
      
      if (!user?.id) {
        setCheckingRegistration(false)
        return
      }

      const response = await fetch(`/api/professor/face-registration/check?professorId=${user.id}`)
      const data = await response.json()

      if (data.success) {
        setIsRegistered(data.isRegistered)
      } else {
        setIsRegistered(false)
      }
    } catch (error) {
      setIsRegistered(false)
    } finally {
      setCheckingRegistration(false)
    }
  }

  const fetchTodayAttendanceRecords = async () => {
    try {
      setLoadingRecords(true)
      const response = await fetch(`/api/professor/attendance/records?sectionId=${sectionId}`)
      const data = await response.json()
      
      if (data.success) {
        const records = data.records || []
        // Records API already returns ALL students with merged attendance status
        // Just sort by status and set directly
        const sorted = records.sort((a: any, b: any) => {
          const statusOrder = { present: 0, late: 1, absent: 2 }
          return (statusOrder[a.status as keyof typeof statusOrder] || 999) - (statusOrder[b.status as keyof typeof statusOrder] || 999)
        })
        setMergedAttendanceData(sorted)
        // Also fetch registered students for the faces section
        fetchRegisteredStudents()
      }
    } catch (error) {
      console.error('Error fetching records:', error)
    } finally {
      setLoadingRecords(false)
    }
  }

  const fetchRegisteredStudents = async () => {
    try {
      const response = await fetch(`/api/professor/attendance/registered-students?sectionId=${sectionId}`)
      const data = await response.json()
      
      if (data.success) {
        setRegisteredStudents(data.students || [])
        console.log('Registered students:', data.students?.length || 0)
      }
    } catch (error) {
      console.error('Error fetching registered students:', error)
    }
  }


  const handleRegistrationComplete = () => {
    setIsRegistered(true)
    checkFaceRegistration()
    // Refresh attendance records to show newly registered student
    fetchTodayAttendanceRecords()
  }

  if (loading || checkingRegistration || loadingRecords) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user) return null

  // If using face entry method and not registered, show registration modal
  if (entryMethod === 'face' && !isRegistered) {
    return (
      <FaceRegistrationModal
        professorId={user?.id || ''}
        professorName={`${user?.firstName} ${user?.lastName}`}
        onComplete={handleRegistrationComplete}
        onCancel={() => router.push('/professor')}
      />
    )
  }

  // If using face entry method and registered but not verified, show verification modal
  if (entryMethod === 'face' && isRegistered && !faceVerified) {
    return (
      <FaceVerificationModal
        professorId={user?.id || ''}
        professorName={`${user?.firstName} ${user?.lastName}`}
        onVerificationSuccess={() => {
          setFaceVerified(true)
          // Store verification in session to prevent bypass
          sessionStorage.setItem(`face-verified-${sectionId}`, 'true')
        }}
        onCancel={() => router.push('/professor')}
      />
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50/50">
      {/* Success Notification Banner */}
      {newStudentNotification && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-top duration-300">
          <div className="bg-emerald-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3">
            <Check className="h-5 w-5" />
            <span className="font-medium">{newStudentNotification}</span>
            <button 
              onClick={() => setNewStudentNotification(null)}
              className="ml-2 hover:bg-emerald-700 rounded p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 bg-background border-b px-6">
        <Button variant="ghost" size="icon" onClick={() => router.push('/professor')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Class Session</h1>
          <p className="text-xs text-muted-foreground hidden sm:block">Manage attendance for today</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowStudentRegModal(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Register Student
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full py-8 space-y-8 px-6">
        {/* Status Indicators */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Today's Date</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                <p className="text-xs text-gray-500 mt-2">Daily attendance tracking</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Clock className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Attendees</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {mergedAttendanceData.filter(s => s.status !== 'absent').length} <span className="text-lg text-gray-400">/ {mergedAttendanceData.length}</span>
                </p>
                <p className="text-xs text-gray-500 mt-2">Students present or late</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <Users className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-gray-200 bg-white rounded-t-xl">
          <button
            onClick={() => setActiveTab('attendance')}
            className={`flex items-center gap-2 px-6 py-3 font-medium text-sm border-b-2 transition-all duration-200 ${
              activeTab === 'attendance'
                ? 'border-black text-gray-900 bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            Attendance Log
          </button>
          <button
            onClick={() => setActiveTab('faces')}
            className={`flex items-center gap-2 px-6 py-3 font-medium text-sm border-b-2 transition-all duration-200 ${
              activeTab === 'faces'
                ? 'border-black text-gray-900 bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <User className="w-4 h-4" />
            Registered Faces
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'faces' && (
          <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 p-6 space-y-4 shadow-sm">
            <div className="px-1">
              <h2 className="text-lg font-semibold tracking-tight">Registered Student Faces</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Manage facial recognition data for all students
              </p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {registeredStudents.length === 0 ? (
                <div className="col-span-full h-32 flex flex-col items-center justify-center text-gray-500 border-2 border-dashed rounded-lg bg-gray-50/50">
                  <Users className="h-8 w-8 mb-2 opacity-20" />
                  <p className="text-sm">No registered faces yet.</p>
                </div>
              ) : (
                registeredStudents.map((student: any) => (
                  <div key={student.id} className="bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                    {/* Student Avatar */}
                    <div className="flex justify-center mb-3 relative">
                      <Avatar className="h-16 w-16 border-2 border-gray-200">
                        <AvatarImage src={student.avatar_url || ''} />
                        <AvatarFallback className={`${student.face_data === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'} font-bold`}>
                          {student.first_name?.charAt(0) || ''}{student.last_name?.charAt(0) || ''}
                        </AvatarFallback>
                      </Avatar>
                      {student.face_data === 'pending' && (
                        <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          No Face
                        </span>
                      )}
                    </div>

                    {/* Student Name */}
                    <div className="text-center mb-3">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {student.first_name} {student.last_name}
                      </p>
                      <p className="text-xs text-gray-500">{student.student_id || 'N/A'}</p>
                    </div>

                    {/* Registration Date */}
                    <p className="text-xs text-gray-400 text-center mb-3">
                      {new Date(student.registered_at).toLocaleDateString()}
                    </p>

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedStudent(student)
                          setShowFaceEditModal(true)
                        }}
                        className="flex-1 text-xs px-2 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Delete facial data for ${student.first_name}?`)) {
                            try {
                              console.log('🗑️ Attempting to delete student:')
                              console.log('   - Student ID field:', student.id)
                              console.log('   - Student data keys:', Object.keys(student))
                              console.log('   - Full student object:', student)
                              
                              const response = await fetch(`/api/professor/attendance/delete-face`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ userId: student.id })
                              })
                              
                              if (!response.ok) {
                                const errorText = await response.text()
                                console.error('❌ Delete failed with status:', response.status)
                                console.error('   Response:', errorText)
                                alert(`Failed to delete: ${response.status} ${response.statusText}`)
                                return
                              }
                              
                              const data = await response.json()
                              if (data.success) {
                                setNewStudentNotification(`Deleted face data for ${student.first_name}`)
                                setTimeout(() => setNewStudentNotification(null), 3000)
                                fetchRegisteredStudents()
                              } else {
                                alert('Failed to delete face data: ' + (data.error || 'Unknown error'))
                              }
                            } catch (error) {
                              console.error('Error deleting face:', error)
                              alert('Error deleting face data: ' + (error instanceof Error ? error.message : 'Unknown error'))
                            }
                          }
                        }}
                        className="flex-1 text-xs px-2 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Attendance List */}
        {activeTab === 'attendance' && (
          <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between px-1">
               <div>
                 <h2 className="text-lg font-semibold tracking-tight">Attendance Log</h2>
                 <p className="text-xs text-muted-foreground mt-1">
                   {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                 </p>
               </div>
               <div className="flex items-center bg-gray-100 rounded-lg p-1 border">
                 <Button 
                   variant={viewMode === 'list' ? 'secondary' : 'ghost'} 
                   size="sm" 
                   onClick={() => setViewMode('list')}
                   className="h-8 w-8 p-0"
                 >
                   <List className="h-4 w-4" />
                 </Button>
                 <Button 
                   variant={viewMode === 'seat-plan' ? 'secondary' : 'ghost'} 
                   size="sm" 
                   onClick={() => setViewMode('seat-plan')}
                   className="h-8 w-8 p-0"
                 >
                   <LayoutGrid className="h-4 w-4" />
                 </Button>
               </div>
            </div>
            
            {viewMode === 'list' ? (
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
             <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Name</TableHead>
                    <TableHead>Student ID</TableHead>
                    <TableHead>Check-in Time</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                   {mergedAttendanceData.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={4} className="h-32 text-center">
                          <div className="flex flex-col items-center justify-center text-muted-foreground">
                            <Users className="h-8 w-8 mb-2 opacity-20" />
                            <p>No students registered.</p>
                          </div>
                       </TableCell>
                     </TableRow>
                   ) : (
                     mergedAttendanceData.map((record: any) => (
                       <TableRow key={record.id} className={record.status === 'absent' ? 'bg-muted/30' : ''}>
                         <TableCell className="font-medium">{record.first_name} {record.last_name}</TableCell>
                         <TableCell>{record.student_number}</TableCell>
                         <TableCell>
                           {record.checked_in_at ? new Date(record.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
                         </TableCell>
                         <TableCell className="text-right">
                           <Badge className={
                             record.status === 'present' ? 'bg-emerald-600 hover:bg-emerald-700' :
                             record.status === 'late' ? 'bg-yellow-600 hover:bg-yellow-700' :
                             record.status === 'absent' ? 'bg-red-600 hover:bg-red-700' :
                             'bg-gray-500 hover:bg-gray-600'
                           }>
                             {record.status ? record.status.charAt(0).toUpperCase() + record.status.slice(1) : 'None'}
                           </Badge>
                         </TableCell>
                       </TableRow>
                     ))
                   )}
                </TableBody>
             </Table>
          </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {mergedAttendanceData.length === 0 ? (
                <div className="col-span-full h-64 flex flex-col items-center justify-center text-gray-500 border-2 border-dashed rounded-lg bg-gray-50/50">
                   <Users className="h-12 w-12 mb-3 opacity-20" />
                   <p>No students registered in this class.</p>
                </div>
              ) : (
                mergedAttendanceData.map((record: any, index: number) => {
                  const isPresent = record.status === 'present';
                  const isLate = record.status === 'late';
                  const isAbsent = !isPresent && !isLate;

                  return (
                    <div 
                      key={record.id} 
                      className={`
                        relative flex flex-col p-4 rounded-xl border-2 transition-all duration-300
                        ${isPresent 
                            ? 'bg-emerald-50 border-emerald-200' 
                            : isLate 
                              ? 'bg-amber-50 border-amber-200' 
                              : 'bg-red-50 border-red-200'
                        }
                      `}
                    >
                      {/* Seat Label */}
                      <div className="absolute top-2 right-2 text-xs font-mono text-gray-400 font-bold">
                        #{index + 1}
                      </div>

                      {/* Computer Monitor */}
                      <div className="flex justify-center mb-3">
                         <div className={`p-3 rounded-full ${
                            isPresent 
                              ? 'bg-emerald-100' 
                              : isLate 
                                ? 'bg-amber-100' 
                                : 'bg-red-100'
                         }`}>
                           <Monitor className={`w-6 h-6 ${
                              isPresent 
                                ? 'text-emerald-600' 
                                : isLate 
                                  ? 'text-amber-600' 
                                  : 'text-red-500'
                           }`} />
                         </div>
                      </div>

                      {/* Student Info */}
                      <div className="text-center flex-1 flex flex-col justify-end">
                        <p className={`text-sm font-bold leading-tight mb-1 truncate ${
                            isPresent 
                              ? 'text-emerald-900' 
                              : isLate 
                                ? 'text-amber-900' 
                                : 'text-red-900'
                        }`}>
                          {record.first_name} {record.last_name}
                        </p>
                        
                        <Badge variant="outline" className={`w-full justify-center text-[10px] h-5 px-0 ${
                            isPresent 
                              ? 'border-emerald-300 text-emerald-700 bg-emerald-50' 
                              : isLate 
                                ? 'border-amber-300 text-amber-700 bg-amber-50' 
                                : 'border-red-300 text-red-700 bg-red-50'
                        }`}>
                             {isLate ? 'LATE' : (isPresent ? 'PRESENT' : 'ABSENT')}
                        </Badge>
                      </div>

                      {/* Seat Base Visual */}
                      <div className="mt-3 h-1 w-full bg-gray-200 rounded-full opacity-50"></div>
                    </div>
                  )
                })
              )}
            </div>
          )}
          </div>
        )}
      </main>

      {/* Student Registration Modal */}
      {showStudentRegModal && (
        <StudentRegistrationModal
          sectionId={sectionId}
          onClose={() => setShowStudentRegModal(false)}
          onRegistrationSuccess={() => {
            setShowStudentRegModal(false)
            // Refresh both registered students and attendance records
            fetchRegisteredStudents()
            fetchTodayAttendanceRecords()
          }}
        />
      )}

      {/* Attendance Recognition Modal */}
      {showFaceRecognitionModal && (
        <AttendanceRecognitionModal
          sectionId={sectionId}
          isOpen={showFaceRecognitionModal}
          onClose={() => setShowFaceRecognitionModal(false)}
          onStudentMarked={async () => {
            await fetchTodayAttendanceRecords()
          }}
        />
      )}

      {/* Edit Face Modal */}
      {showFaceEditModal && selectedStudent && (
        <EditFaceModal
          student={selectedStudent}
          onClose={() => {
            setShowFaceEditModal(false)
            setSelectedStudent(null)
          }}
          onSuccess={() => {
            setShowFaceEditModal(false)
            setSelectedStudent(null)
            setNewStudentNotification(`Updated face data for ${selectedStudent.first_name}`)
            setTimeout(() => setNewStudentNotification(null), 3000)
            fetchRegisteredStudents()
          }}
        />
      )}
    </div>
  )
}

// --- Student Registration Modal ---

interface StudentRegistrationModalProps {
  sectionId: string
  onClose: () => void
  onRegistrationSuccess?: () => void
}

interface StudentCredentials {
  email: string
  password: string
  firstName: string
  lastName: string
}

type StudentLivenessStep = 'center' | 'left' | 'right' | 'up' | 'complete'

interface StudentLivenessProgress {
  center: boolean
  left: boolean
  right: boolean
  up: boolean
}

function StudentRegistrationModal({ sectionId, onClose, onRegistrationSuccess }: StudentRegistrationModalProps) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    middleInitial: '',
    studentId: '',
    email: ''
  })
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  const [credentials, setCredentials] = useState<StudentCredentials | null>(null)
  const [validationErrors, setValidationErrors] = useState<{
    studentId?: string
    email?: string
  }>({})
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [checkingStudentId, setCheckingStudentId] = useState(false)
  
  // New states for bounding box and auto-capture
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [recognizedName, setRecognizedName] = useState<string | null>(null)
  const [recognitionConfidence, setRecognitionConfidence] = useState<number | null>(null)
  const [captureCountdown, setCaptureCountdown] = useState<number | null>(null)
  const [autoCapture, setAutoCapture] = useState(true)

  const serverCanvasRef = useRef<HTMLCanvasElement>(null)
  const serverStreamRef = useRef<ServerCameraStream | null>(null)
  const serverImgRef = useRef<HTMLImageElement | null>(null)
  const lastFrameRef = useRef<string | null>(null)
  const pendingFrameRef = useRef<CameraStreamFrame | null>(null)
  const rafRef = useRef<number>(0)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const faceStableStartRef = useRef<number | null>(null)
  const consecutiveFaceDetectionsRef = useRef<number>(0)
  const autoCaptureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const savedFaceDescriptorRef = useRef<Float32Array | null>(null)
  const lastRecognitionTimeRef = useRef<number>(0)
  const isNewStudentConfirmedRef = useRef<boolean>(false)

  // Validate email uniqueness
  useEffect(() => {
    const validateEmail = async () => {
      if (!formData.email) {
        setValidationErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.email
          return newErrors
        })
        return
      }

      setCheckingEmail(true)
      try {
        const response = await fetch(`/api/student/check-email?email=${encodeURIComponent(formData.email)}`)
        const data = await response.json()

        if (data.exists) {
          setValidationErrors(prev => ({
            ...prev,
            email: 'This email is already registered'
          }))
        } else {
          setValidationErrors(prev => {
            const newErrors = { ...prev }
            delete newErrors.email
            return newErrors
          })
        }
      } catch (error) {
        console.error('Error checking email:', error)
      } finally {
        setCheckingEmail(false)
      }
    }

    const timer = setTimeout(validateEmail, 500)
    return () => clearTimeout(timer)
  }, [formData.email])

  // Validate student ID uniqueness
  useEffect(() => {
    const validateStudentId = async () => {
      if (!formData.studentId) {
        setValidationErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.studentId
          return newErrors
        })
        return
      }

      setCheckingStudentId(true)
      try {
        const response = await fetch(`/api/student/check-student-id?studentId=${encodeURIComponent(formData.studentId)}`)
        const data = await response.json()

        if (data.exists) {
          setValidationErrors(prev => ({
            ...prev,
            studentId: 'This student ID is already registered'
          }))
        } else {
          setValidationErrors(prev => {
            const newErrors = { ...prev }
            delete newErrors.studentId
            return newErrors
          })
        }
      } catch (error) {
        console.error('Error checking student ID:', error)
      } finally {
        setCheckingStudentId(false)
      }
    }

    const timer = setTimeout(validateStudentId, 500)
    return () => clearTimeout(timer)
  }, [formData.studentId])

  useEffect(() => {
    // Server camera replaces local MediaPipe — just check health
    const checkServer = async () => {
      const healthy = await checkFaceNetHealth()
      setModelsLoaded(healthy)
    }
    checkServer()
  }, [])

  useEffect(() => {
    if (!showCamera) return
    return () => {
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
      if (autoCaptureTimeoutRef.current) clearTimeout(autoCaptureTimeoutRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [showCamera])

  const drawServerFrame = useCallback((data: CameraStreamFrame) => {
    const canvas = serverCanvasRef.current
    if (!canvas || !data.frame) return
    if (!serverImgRef.current) serverImgRef.current = new Image()
    const img = serverImgRef.current
    img.onload = () => {
      canvas.width = data.width || img.naturalWidth
      canvas.height = data.height || img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    img.src = `data:image/jpeg;base64,${data.frame}`
  }, [])

  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      const frame = pendingFrameRef.current
      if (frame) { pendingFrameRef.current = null; drawServerFrame(frame) }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(rafRef.current) }
  }, [drawServerFrame])

  const handleServerFrame = useCallback((data: CameraStreamFrame) => {
    pendingFrameRef.current = data
    if (data.frame) lastFrameRef.current = data.frame

    // Only process results on frames that ran through the pipeline
    if (data.results === null || data.results === undefined) return

    // Server stream in 'extract' mode returns a FaceNetEmbedding-like object.
    // Some variants may wrap multiple faces; normalize defensively.
    const rawResults = data.results as any
    const face: any =
      (Array.isArray(rawResults) ? rawResults[0] : null) ??
      (rawResults && Array.isArray(rawResults.faces) ? rawResults.faces[0] : null) ??
      rawResults

    if (!face || !face.embedding) {
      setBoundingBox(null)
      consecutiveFaceDetectionsRef.current = 0
      faceStableStartRef.current = null
      setCaptureCountdown(null)
      setFaceDetected(false)
      setRecognizedName(null)
      setRecognitionConfidence(null)
      return
    }

    if (face.spoofDetected ?? face.spoof_detected) {
      consecutiveFaceDetectionsRef.current = 0
      faceStableStartRef.current = null
      setCaptureCountdown(null)
      return
    }

    setFaceDetected(true)
    const descriptor = new Float32Array(face.embedding)
    setFaceDescriptor(descriptor)
    savedFaceDescriptorRef.current = descriptor

    if (face.box) {
      const box = face.box as {
        x?: number
        y?: number
        width?: number
        height?: number
        left?: number
        top?: number
        right?: number
        bottom?: number
      }
      const x = box.x ?? box.left ?? 0
      const y = box.y ?? box.top ?? 0
      const width = box.width ?? Math.max(0, (box.right ?? 0) - x)
      const height = box.height ?? Math.max(0, (box.bottom ?? 0) - y)
      setBoundingBox({ x, y, width, height })
    }

    consecutiveFaceDetectionsRef.current += 1

    // DB match check (throttled)
    const now = Date.now()
    const MATCH_THROTTLE_MS = 2000
    if (now - lastRecognitionTimeRef.current >= MATCH_THROTTLE_MS) {
      lastRecognitionTimeRef.current = now
      fetch('/api/attendance/match-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faceDescriptor: Array.from(descriptor) })
      }).then(r => r.json()).then(matchData => {
        if (matchData.success && matchData.matched) {
          setRecognizedName(`${matchData.student.first_name} ${matchData.student.last_name}`)
          setRecognitionConfidence(matchData.confidence)
          isNewStudentConfirmedRef.current = false
        } else {
          setRecognizedName('New Student')
          setRecognitionConfidence(null)
          isNewStudentConfirmedRef.current = true
        }
      }).catch(() => {})
    }

    // Auto-capture when confirmed new student
    if (autoCapture && !isCapturing && isNewStudentConfirmedRef.current) {
      capturePhoto()
    }
  }, [autoCapture, isCapturing])

  const startCamera = async () => {
    if (!modelsLoaded) {
      alert('Face recognition server loading...')
      return
    }

    try {
      const stream = new ServerCameraStream()
      serverStreamRef.current = stream
      stream.start('extract', handleServerFrame, (err) => {
        console.error('Server camera error:', err)
      })
      setShowCamera(true)
    } catch (error: any) {
      alert(`Camera server error: ${error.message}`)
    }
  }

  const stopCamera = () => {
    if (serverStreamRef.current) {
      serverStreamRef.current.stop()
      serverStreamRef.current = null
    }
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
    if (autoCaptureTimeoutRef.current) clearTimeout(autoCaptureTimeoutRef.current)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)

    setShowCamera(false)
    setIsCapturing(false)
    setFaceDetected(false)
    setFaceDescriptor(null)
    setBoundingBox(null)
    setRecognizedName(null)
    setRecognitionConfidence(null)
    setCaptureCountdown(null)
    lastFrameRef.current = null
    faceStableStartRef.current = null
    consecutiveFaceDetectionsRef.current = 0
    isNewStudentConfirmedRef.current = false
  }

  const capturePhoto = () => {
    const descriptorToCheck = faceDescriptor || savedFaceDescriptorRef.current
    
    if (!descriptorToCheck) {
      alert('Face not detected! Please position your face clearly in the camera and wait for detection.')
      setIsCapturing(false)
      return
    }
    
    if (!lastFrameRef.current) return

    if (!isCapturing) {
      setIsCapturing(true)
      
      const savedDescriptor = faceDescriptor
      if (savedDescriptor) {
        savedFaceDescriptorRef.current = savedDescriptor
      }
      
      setCapturedImage(`data:image/jpeg;base64,${lastFrameRef.current}`)
      stopCamera()
      
      if (savedDescriptor) {
        setFaceDescriptor(savedDescriptor)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.firstName || !formData.lastName || !formData.studentId || !formData.email || !capturedImage) {
      alert('Please fill all required fields and capture your photo')
      return
    }

    setIsSubmitting(true)
    try {
      // Use descriptor from ref if state is null (more reliable)
      const descriptorToUse = faceDescriptor || savedFaceDescriptorRef.current
      const descriptorArray = descriptorToUse ? Array.from(descriptorToUse) : null
      
      console.log('📤 Submitting student registration:')
      console.log('   - Student ID:', formData.studentId)
      console.log('   - Face descriptor from state:', !!faceDescriptor)
      console.log('   - Face descriptor from ref:', !!savedFaceDescriptorRef.current)
      console.log('   - Final descriptor used:', !!descriptorToUse)
      console.log('   - Descriptor length:', descriptorArray?.length)
      console.log('   - Descriptor sample:', descriptorArray?.slice(0, 5))

      const response = await fetch('/api/student/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          middleInitial: formData.middleInitial,
          studentId: formData.studentId,
          email: formData.email,
          sectionId: sectionId,
          faceData: capturedImage,
          faceDescriptor: descriptorArray
        })
      })

      const data = await response.json()
      if (data.success && data.credentials) {
        setCredentials(data.credentials)
        
        // Broadcast event to notify that a new student was registered
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('student-registered', {
            detail: {
              studentId: formData.studentId,
              firstName: formData.firstName,
              lastName: formData.lastName,
              email: formData.email,
              timestamp: new Date().toISOString()
            }
          }))
          console.log('✅ Student registration event broadcasted from professor modal')
        }

        // Also update localStorage for cross-tab communication
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('last-student-registration', JSON.stringify({
            studentId: formData.studentId,
            firstName: formData.firstName,
            lastName: formData.lastName,
            timestamp: new Date().toISOString()
          }))
        }
        
        // Call callback to refresh student list in parent
        onRegistrationSuccess?.()
      } else {
        alert(data.error || 'Failed to create student account')
      }
    } catch (error) {
      alert('Failed to register student')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (credentials) {
    return (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <Card className="w-full max-w-lg shadow-xl border-border/40">
          <CardHeader>
            <CardTitle>Student Account Created</CardTitle>
            <CardDescription>
              Share these credentials with the student
            </CardDescription>
          </CardHeader>

          <div className="p-6 pt-0 space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Student Name</p>
                <p className="text-lg font-semibold text-gray-900">{credentials.firstName} {credentials.lastName}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Email</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white px-3 py-2 rounded border border-gray-300 text-sm font-mono">{credentials.email}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(credentials.email)
                      alert('Email copied!')
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Temporary Password</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white px-3 py-2 rounded border border-gray-300 text-sm font-mono">{credentials.password}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(credentials.password)
                      alert('Password copied!')
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Note:</span> Student should change their password on first login.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 p-6 pt-0 border-t">
            <Button onClick={onClose}>Close</Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <Card className={`w-full shadow-xl border-border/40 transition-all ${
        showCamera ? 'max-w-2xl' : 'max-w-lg max-h-[90vh] overflow-y-auto'
      }`}>
        <CardHeader>
          <CardTitle>Register New Student</CardTitle>
          <CardDescription>
            Create a student account with facial recognition
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <div className="p-6 pt-0 space-y-6">
            {/* Personal Information - Hide when camera is active */}
            {!showCamera && (
              <div className="space-y-4">
                <h3 className="font-semibold text-sm">Personal Information</h3>
                <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">First Name *</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Last Name *</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Middle Initial</label>
                  <input
                    type="text"
                    maxLength={1}
                    value={formData.middleInitial}
                    onChange={(e) => setFormData(prev => ({ ...prev, middleInitial: e.target.value.toUpperCase() }))}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="e.g., J"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Student ID *</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.studentId}
                      onChange={(e) => setFormData(prev => ({ ...prev, studentId: e.target.value }))}
                      className={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 ${
                        validationErrors.studentId
                          ? 'border-red-500 focus-visible:ring-red-500'
                          : 'border-input focus-visible:ring-ring'
                      }`}
                      placeholder="e.g., 2024-001"
                      required
                    />
                    {checkingStudentId && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Checking...</span>
                    )}
                  </div>
                  {validationErrors.studentId && (
                    <p className="text-xs text-red-600">{validationErrors.studentId}</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Gmail/Email *</label>
                <div className="relative">
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 ${
                      validationErrors.email
                        ? 'border-red-500 focus-visible:ring-red-500'
                        : 'border-input focus-visible:ring-ring'
                    }`}
                    placeholder="e.g., student@gmail.com"
                    required
                  />
                  {checkingEmail && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Checking...</span>
                  )}
                </div>
                {validationErrors.email && (
                  <p className="text-xs text-red-600">{validationErrors.email}</p>
                )}
              </div>
            </div>
            )}

            {/* Photo Verification */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Photo Verification</h3>

              {!showCamera && !capturedImage && (
                <div className="border border-dashed rounded-lg p-8 flex flex-col items-center justify-center bg-muted/30 hover:bg-muted/50 transition-colors">
                  <ScanFace className="h-10 w-10 text-violet-400 mb-4" />
                  <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
                    Position the student in front of the camera. The system detects and captures automatically.
                  </p>
                  <Button type="button" onClick={startCamera} disabled={!modelsLoaded}>
                    {modelsLoaded ? 'Start Camera' : 'Loading Models...'}
                  </Button>
                </div>
              )}

              {showCamera && (
                <div className="flex flex-col gap-4">
                  <div className="relative w-full aspect-video md:aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-inner ring-1 ring-gray-900/5 flex items-center justify-center">
                    <canvas
                      ref={serverCanvasRef}
                      className="w-full h-full object-cover"
                    />

                    {/* Camera Guide Overlay */}
                    <div className="absolute inset-0 pointer-events-none p-6 flex items-center justify-center">
                       <div className={`w-48 h-64 border-2 rounded-full border-dashed transition-all duration-300 ${
                         faceDetected && recognizedName === 'New Student' ? 'border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.5)]' :
                         faceDetected && recognizedName ? 'border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.5)]' :
                         faceDetected ? 'border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)]' :
                         'border-white/30 animate-pulse'
                       }`} />
                    </div>

                    {!faceDetected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-all duration-300">
                        <div className="text-center text-white flex flex-col items-center">
                          <ScanFace className="w-10 h-10 animate-bounce mb-3 opacity-80" />
                          <p className="text-sm font-medium">Position face in frame</p>
                        </div>
                      </div>
                    )}

                    {/* Already registered warning */}
                    {recognizedName && recognizedName !== 'New Student' && recognitionConfidence !== null && (
                      <div className="absolute top-4 inset-x-0 flex justify-center pointer-events-none z-10">
                        <div className="bg-amber-500/90 backdrop-blur-md text-white text-sm font-medium px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
                          <CircleAlert className="w-4 h-4" />
                          {recognizedName} - Already Registered
                        </div>
                      </div>
                    )}

                    {/* Auto-capturing indicator */}
                    {faceDetected && recognizedName === 'New Student' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-emerald-900/20 transition-all duration-300 pointer-events-none">
                        <div className="absolute top-4 inset-x-0 flex justify-center">
                          <div className="bg-emerald-500/90 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2 shadow-lg animate-pulse">
                            <Camera className="w-4 h-4" /> 
                            New Student - Capturing...
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-center w-full">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={stopCamera}
                      className="w-full max-w-sm rounded-xl"
                    >
                      Cancel Camera
                    </Button>
                  </div>
                </div>
              )}

              {capturedImage && !showCamera && (
                <div className="flex flex-col gap-4">
                  <div className="relative w-full aspect-video md:aspect-[4/3] bg-gray-100 rounded-2xl overflow-hidden ring-2 ring-emerald-500 shadow-md flex items-center justify-center">
                    <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
                    <div className="absolute top-4 inset-x-0 flex justify-center pointer-events-none">
                      <div className="bg-emerald-600/90 backdrop-blur-md text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
                        <CircleCheck className="w-4 h-4" />
                        Face Captured Successfully
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-center w-full">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => { setCapturedImage(null); startCamera() }}
                      className="w-full max-w-sm rounded-xl flex items-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Retake Photo
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between p-6 pt-0 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !capturedImage || Object.keys(validationErrors).length > 0}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Account
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

// --- Attendance Recognition Modal ---

interface AttendanceRecognitionModalProps {
  sectionId: string
  isOpen: boolean
  onClose: () => void
  onStudentMarked: () => Promise<void>
}

function AttendanceRecognitionModal({ sectionId, isOpen, onClose, onStudentMarked }: AttendanceRecognitionModalProps) {
  const [showCamera, setShowCamera] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [detectedFaces, setDetectedFaces] = useState<any[]>([]) // Array of detected faces with boxes and names
  const [recognitionError, setRecognitionError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const serverCanvasRef2 = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef2 = useRef<HTMLCanvasElement>(null)
  const serverStreamRef2 = useRef<ServerCameraStream | null>(null)
  const serverImgRef2 = useRef<HTMLImageElement | null>(null)
  const pendingFrameRef2 = useRef<CameraStreamFrame | null>(null)
  const rafRef2 = useRef<number>(0)
  const markedStudentsRef = useRef<Set<string>>(new Set())
  const animationFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const checkServer = async () => {
      const healthy = await checkFaceNetHealth()
      setModelsLoaded(healthy)
    }
    checkServer()
  }, [])

  const drawServerFrame2 = useCallback((data: CameraStreamFrame) => {
    const canvas = serverCanvasRef2.current
    if (!canvas || !data.frame) return
    if (!serverImgRef2.current) serverImgRef2.current = new Image()
    const img = serverImgRef2.current
    img.onload = () => {
      canvas.width = data.width || img.naturalWidth
      canvas.height = data.height || img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    img.src = `data:image/jpeg;base64,${data.frame}`
  }, [])

  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      const frame = pendingFrameRef2.current
      if (frame) { pendingFrameRef2.current = null; drawServerFrame2(frame) }
      rafRef2.current = requestAnimationFrame(tick)
    }
    rafRef2.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(rafRef2.current) }
  }, [drawServerFrame2])

  const handleServerFrame2 = useCallback((data: CameraStreamFrame) => {
    pendingFrameRef2.current = data

    if (isProcessing) return

    // Only process results on frames that ran through the pipeline
    if (data.results === null || data.results === undefined) return

    // extract mode returns a single FaceNetEmbedding object
    const face = data.results as FaceNetEmbedding
    if (!face.detected || face.spoof_detected || !face.embedding) {
      setDetectedFaces([])
      return
    }

    const descriptor = new Float32Array(face.embedding)
    const box = face.box || {
      x: (data.width || 640) * 0.25,
      y: (data.height || 480) * 0.15,
      width: (data.width || 640) * 0.5,
      height: (data.height || 480) * 0.7
    }
    matchAndMarkAttendance(descriptor, box)
  }, [isProcessing])

  const startCamera = async () => {
    if (!modelsLoaded) {
      setRecognitionError('Face recognition server is still loading...')
      return
    }

    try {
      const stream = new ServerCameraStream()
      serverStreamRef2.current = stream
      stream.start('extract', handleServerFrame2, (err) => {
        setRecognitionError(`Camera error: ${err}`)
      })
      setRecognitionError(null)
      setShowCamera(true)
    } catch (error: any) {
      setRecognitionError(`Camera server error: ${error.message}`)
    }
  }

  const stopCamera = () => {
    if (serverStreamRef2.current) {
      serverStreamRef2.current.stop()
      serverStreamRef2.current = null
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    setShowCamera(false)
    setDetectedFaces([])
    markedStudentsRef.current.clear()
  }

  // Overlay drawing for detected faces
  useEffect(() => {
    if (!showCamera || !overlayCanvasRef2.current || !serverCanvasRef2.current) return

    const canvas = overlayCanvasRef2.current
    const source = serverCanvasRef2.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawFrame = () => {
      canvas.width = source.width || 640
      canvas.height = source.height || 480
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      detectedFaces.forEach(face => {
        const { box, name, confidence, status } = face
        const color = status === 'marked' ? '#10b981' : status === 'recognized' ? '#3b82f6' : '#ef4444'
        
        ctx.strokeStyle = color
        ctx.lineWidth = 3
        ctx.strokeRect(box.x, box.y, box.width, box.height)
        
        const text = name || 'Unknown'
        ctx.font = 'bold 16px Arial'
        const textWidth = ctx.measureText(text).width
        const padding = 8
        
        ctx.fillStyle = color
        ctx.fillRect(box.x, box.y - 24 - padding, textWidth + padding * 2, 24 + padding)
        
        ctx.fillStyle = '#ffffff'
        ctx.fillText(text, box.x + padding, box.y - padding)
      })

      animationFrameRef.current = requestAnimationFrame(drawFrame)
    }

    drawFrame()
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [showCamera, detectedFaces])

  const matchAndMarkAttendance = async (descriptor: Float32Array, box: any) => {
    if (isProcessing) {
      return
    }
    
    setIsProcessing(true)

    try {
      // Match face
      const matchResponse = await fetch('/api/attendance/match-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          faceDescriptor: Array.from(descriptor)
        })
      })

      const matchData = await matchResponse.json()

      if (!matchData.success || !matchData.matched) {
        // Unknown face
        setDetectedFaces([{
          box,
          name: 'Unknown',
          confidence: null,
          status: 'unknown'
        }])
        setIsProcessing(false)
        return
      }

      const student = matchData.student
      
      // Check if already marked in this session
      if (markedStudentsRef.current.has(student.id)) {
        // Already marked, show as green
        setDetectedFaces([{
          box,
          name: `${student.first_name} ${student.last_name}`,
          confidence: matchData.confidence,
          status: 'marked'
        }])
        setIsProcessing(false)
        return
      }

      // Show as recognized (blue)
      setDetectedFaces([{
        box,
        name: `${student.first_name} ${student.last_name}`,
        confidence: matchData.confidence,
        status: 'recognized'
      }])
      
      // Mark attendance
      const markResponse = await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: sectionId,
          studentId: student.id,
          faceMatchConfidence: matchData.confidence
        })
      })

      const markData = await markResponse.json()

      if (markData.success) {
        console.log('✅ Attendance marked successfully for:', student.first_name)
        
        // Add to marked students
        markedStudentsRef.current.add(student.id)
        
        // Show as marked (green)
        setDetectedFaces([{
          box,
          name: `${student.first_name} ${student.last_name}`,
          confidence: matchData.confidence,
          status: 'marked'
        }])
        
        // Refresh records
        await onStudentMarked()
        
        // Continue scanning after a brief pause
        setTimeout(() => {
          setDetectedFaces([])
          setIsProcessing(false)
        }, 1500)
      } else {
        console.log('❌ Failed to mark attendance')
        setRecognitionError('Failed to mark attendance')
        setIsProcessing(false)
        setDetectedFaces([])
      }
    } catch (error: any) {
      console.error('❌ Error:', error)
      setRecognitionError(error.message || 'Error processing attendance')
      setIsProcessing(false)
      setDetectedFaces([])
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-2xl shadow-xl border-border/40">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle>Mark Attendance</CardTitle>
            <CardDescription>
              Face recognition in progress. {detectedFaces.length > 0 && detectedFaces[0].status === 'marked' ? 'Student recognized!' : 'Position your face in the camera.'}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {!showCamera ? (
            <div className="text-center py-8">
              <Button onClick={startCamera} disabled={!modelsLoaded} className="gap-2">
                <Camera className="h-4 w-4" />
                {modelsLoaded ? 'Start Camera' : 'Loading Models...'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center">
                <canvas
                  ref={serverCanvasRef2}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                
                {/* Canvas overlay for bounding boxes */}
                <canvas
                  ref={overlayCanvasRef2}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                />

                {recognitionError && (
                  <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 bg-red-600 text-white px-3 py-2 rounded-lg text-sm">
                    <X className="h-4 w-4" />
                    {recognitionError}
                  </div>
                )}

                {detectedFaces.length === 0 && !recognitionError && (
                  <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 bg-gray-700/70 text-white px-3 py-2 rounded-lg text-sm">
                    <div className="h-2 w-2 bg-white rounded-full animate-pulse" />
                    Scanning for faces...
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={stopCamera}>
                  Stop Camera
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// --- Face Registration Modal (Minimalist) ---

interface FaceRegistrationModalProps {
  professorId: string
  professorName: string
  onComplete: () => void
  onSkip?: () => void
  onCancel?: () => void
}

type LivenessStep = 'center' | 'left' | 'right' | 'up' | 'complete'

interface LivenessProgress {
  center: boolean
  left: boolean
  right: boolean
  up: boolean
  rotate: boolean
}

function FaceRegistrationModal({ professorId, professorName, onComplete, onSkip, onCancel }: FaceRegistrationModalProps) {
  // Parse professor name into first and last name
  const [firstName, lastName] = professorName.split(' ').length > 1 
    ? [professorName.split(' ')[0], professorName.split(' ').slice(1).join(' ')] 
    : [professorName, '']

  const [formData, setFormData] = useState({
    firstName: firstName,
    lastName: lastName
  })
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  
  const serverCanvasRef3 = useRef<HTMLCanvasElement>(null)
  const serverStreamRef3 = useRef<ServerCameraStream | null>(null)
  const serverImgRef3 = useRef<HTMLImageElement | null>(null)
  const lastFrameRef3 = useRef<string | null>(null)
  const pendingFrameRef3 = useRef<CameraStreamFrame | null>(null)
  const rafRef3 = useRef<number>(0)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const checkServer = async () => {
      const healthy = await checkFaceNetHealth()
      setModelsLoaded(healthy)
    }
    checkServer()
  }, [])

  const drawServerFrame3 = useCallback((data: CameraStreamFrame) => {
    const canvas = serverCanvasRef3.current
    if (!canvas || !data.frame) return
    if (!serverImgRef3.current) serverImgRef3.current = new Image()
    const img = serverImgRef3.current
    img.onload = () => {
      canvas.width = data.width || img.naturalWidth
      canvas.height = data.height || img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    img.src = `data:image/jpeg;base64,${data.frame}`
  }, [])

  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      const frame = pendingFrameRef3.current
      if (frame) { pendingFrameRef3.current = null; drawServerFrame3(frame) }
      rafRef3.current = requestAnimationFrame(tick)
    }
    rafRef3.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(rafRef3.current) }
  }, [drawServerFrame3])

  const handleServerFrame3 = useCallback((data: CameraStreamFrame) => {
    pendingFrameRef3.current = data
    if (data.frame) lastFrameRef3.current = data.frame

    // Only process results on frames that ran through the pipeline
    if (data.results === null || data.results === undefined) return

    // extract mode returns a single FaceNetEmbedding object
    const face = data.results as FaceNetEmbedding
    if (!face.detected || face.spoof_detected || !face.embedding) {
      setFaceDetected(false)
      setFaceDescriptor(null)
      return
    }

    setFaceDetected(true)
    setFaceDescriptor(new Float32Array(face.embedding))
  }, [])

  const startCamera = async () => {
    if (!modelsLoaded) {
      alert('Face recognition server loading...')
      return
    }

    try {
      const stream = new ServerCameraStream()
      serverStreamRef3.current = stream
      stream.start('extract', handleServerFrame3, (err) => {
        console.error('Server camera error:', err)
      })
      setShowCamera(true)
    } catch (error: any) {
      alert(`Camera server error: ${error.message}`)
    }
  }

  const stopCamera = () => {
    if (serverStreamRef3.current) {
      serverStreamRef3.current.stop()
      serverStreamRef3.current = null
    }
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
    setShowCamera(false)
    setIsCapturing(false)
    setFaceDetected(false)
    setFaceDescriptor(null)
    lastFrameRef3.current = null
  }

  const capturePhoto = () => {
    if (!isCapturing && faceDescriptor && lastFrameRef3.current) {
      setIsCapturing(true)
      const savedDescriptor = faceDescriptor
      setCapturedImage(`data:image/jpeg;base64,${lastFrameRef3.current}`)
      stopCamera()
      setFaceDescriptor(savedDescriptor)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.firstName || !formData.lastName || !capturedImage) return

    setIsSubmitting(true)
    try {
      const descriptorArray = faceDescriptor ? Array.from(faceDescriptor) : null
      
      console.log('📤 Submitting professor registration:')
      console.log('   - Professor ID:', professorId)
      console.log('   - Has face descriptor:', !!descriptorArray)
      console.log('   - Descriptor length:', descriptorArray?.length)
      
      const response = await fetch('/api/professor/face-registration/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          professorId,
          firstName: formData.firstName,
          lastName: formData.lastName,
          faceData: capturedImage,
          faceDescriptor: descriptorArray
        })
      })

      const data = await response.json()
      console.log('📨 Registration response:', data)
      
      if (data.success) {
        onComplete()
      } else {
        alert(data.error || 'Failed to register')
      }
    } catch (error) {
      console.error('❌ Registration error:', error)
      alert('Failed to register')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-lg shadow-xl border-border/40">
        <CardHeader>
           <CardTitle>Face Registration</CardTitle>
           <CardDescription>
             Security verification required to manage attendance sessions.
           </CardDescription>
        </CardHeader>
        
        <form onSubmit={handleSubmit}>
          <div className="p-6 pt-0 space-y-6">
             <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                 <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">First Name</label>
                 <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    required
                 />
               </div>
               <div className="space-y-2">
                 <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Last Name</label>
                 <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    required
                 />
               </div>
             </div>

             <div className="space-y-4">
                <label className="text-sm font-medium leading-none">Photo Verification</label>
                
                {!showCamera && !capturedImage && (
                  <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center bg-muted/30 hover:bg-muted/50 transition-colors">
                     <ShieldCheck className="h-10 w-10 text-muted-foreground mb-4" />
                     <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
                       Liveness detection enabled. You will be asked to move your head slightly.
                     </p>
                     <Button type="button" onClick={startCamera}>Start Camera</Button>
                  </div>
                )}

                {showCamera && (
                   <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
                      <canvas
                        ref={serverCanvasRef3}
                        className="w-full h-full object-cover"
                      />
                      
                      {/* Minimalist Overlay */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className={`w-48 h-64 border-2 rounded-full transition-colors duration-300 ${
                           faceDetected ? 'border-primary' : 'border-white/30'
                        }`} />
                      </div>

                      {/* Instructions */}
                      <div className="absolute top-4 inset-x-0 flex flex-col items-center pointer-events-none gap-2">
                        <div className="bg-black/80 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md">
                          📍 Look at camera and capture your face
                        </div>
                      </div>



                      {/* Actions */}
                      <div className="absolute bottom-4 inset-x-0 flex justify-center gap-4 px-4 z-10">
                         <Button type="button" variant="destructive" size="sm" onClick={stopCamera}>
                           Cancel
                         </Button>
                         {faceDetected && (
                           <Button type="button" size="sm" onClick={capturePhoto} className="bg-emerald-600 hover:bg-emerald-700">
                              Capture
                           </Button>
                         )}
                      </div>
                   </div>
                )}

                {capturedImage && !showCamera && (
                   <div className="relative rounded-lg overflow-hidden border aspect-video bg-muted">
                      <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
                      <div className="absolute bottom-4 right-4">
                         <Button type="button" variant="secondary" size="sm" onClick={() => {
                            setCapturedImage(null)
                            startCamera()
                         }}>
                           <RefreshCw className="w-4 h-4 mr-2" /> Retake
                         </Button>
                      </div>
                   </div>
                )}
             </div>
          </div>
          
          <div className="flex items-center justify-between p-6 pt-0">
             <div>
              {onCancel ? (
                <Button type="button" variant="ghost" onClick={onCancel} className="mr-2">Cancel</Button>
              ) : onSkip ? (
                <Button type="button" variant="ghost" onClick={onSkip} className="mr-2">Skip</Button>
              ) : null}
             </div>
             <Button type="submit" disabled={isSubmitting || !capturedImage}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Complete Registration
             </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

interface FaceVerificationModalProps {
  professorId: string
  professorName: string
  onVerificationSuccess: () => void
  onCancel?: () => void
}

function FaceVerificationModal({ professorId, professorName, onVerificationSuccess, onCancel }: FaceVerificationModalProps) {
  const router = useRouter()
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  const [verificationMessage, setVerificationMessage] = useState('')
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'scanning' | 'success' | 'failed'>('idle')
  const [capturedDescriptors, setCapturedDescriptors] = useState<Float32Array[]>([])
  const [requireMultipleCaptures, setRequireMultipleCaptures] = useState(true)
  const REQUIRED_CAPTURES = 3 // Require 3 different captures to ensure liveness
  
  const { livenessScore, livenessMetrics, updateLivenessScore, resetLiveness } = usePassiveLivenessDetection()
  const serverCanvasRef4 = useRef<HTMLCanvasElement>(null)
  const serverStreamRef4 = useRef<ServerCameraStream | null>(null)
  const serverImgRef4 = useRef<HTMLImageElement | null>(null)
  const pendingFrameRef4 = useRef<CameraStreamFrame | null>(null)
  const rafRef4 = useRef<number>(0)
  const capturedDescriptorsRef = useRef<Float32Array[]>([])
  const verificationCooldownRef = useRef<boolean>(false)
  const lastVerificationAttemptRef = useRef<number>(0)

  useEffect(() => {
    const checkServer = async () => {
      const healthy = await checkFaceNetHealth()
      setModelsLoaded(healthy)
    }
    checkServer()
  }, [])

  const drawServerFrame4 = useCallback((data: CameraStreamFrame) => {
    const canvas = serverCanvasRef4.current
    if (!canvas || !data.frame) return
    if (!serverImgRef4.current) serverImgRef4.current = new Image()
    const img = serverImgRef4.current
    img.onload = () => {
      canvas.width = data.width || img.naturalWidth
      canvas.height = data.height || img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    img.src = `data:image/jpeg;base64,${data.frame}`
  }, [])

  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      const frame = pendingFrameRef4.current
      if (frame) { pendingFrameRef4.current = null; drawServerFrame4(frame) }
      rafRef4.current = requestAnimationFrame(tick)
    }
    rafRef4.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(rafRef4.current) }
  }, [drawServerFrame4])

  const handleServerFrame4 = useCallback((data: CameraStreamFrame) => {
    pendingFrameRef4.current = data

    // Only process results on frames that ran through the pipeline
    if (data.results === null || data.results === undefined) return

    if (isVerifying || verificationCooldownRef.current) return

    // extract mode returns a single FaceNetEmbedding object
    const face = data.results as FaceNetEmbedding
    if (!face.detected || face.spoof_detected || !face.embedding) {
      setFaceDetected(false)
      return
    }

    setFaceDetected(true)
    const descriptor = new Float32Array(face.embedding)
    setFaceDescriptor(descriptor)

    // Real-time verification
    fetch('/api/professor/face-registration/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        professorId,
        faceDescriptor: Array.from(descriptor)
      })
    }).then(r => r.json()).then(verifyData => {
      const isMatch = verifyData.success && verifyData.verified

      if (isMatch) {
        const currentDescriptors = capturedDescriptorsRef.current
        const isDifferentCapture = currentDescriptors.length === 0 || 
          currentDescriptors.every(prev => {
            let diff = 0
            for (let i = 0; i < 512; i++) {
              diff += Math.abs(descriptor[i] - prev[i])
            }
            return diff > 0.5
          })
        
        if (isDifferentCapture && currentDescriptors.length < REQUIRED_CAPTURES) {
          const updatedDescriptors = [...currentDescriptors, descriptor]
          capturedDescriptorsRef.current = updatedDescriptors
          setCapturedDescriptors(updatedDescriptors)
          
          if (updatedDescriptors.length >= REQUIRED_CAPTURES && !isVerifying) {
            performFaceVerification(updatedDescriptors)
          }
        }
      } else {
        if (capturedDescriptorsRef.current.length > 0) {
          setCapturedDescriptors([])
          capturedDescriptorsRef.current = []
        }
        verificationCooldownRef.current = true
        setVerificationMessage('Face not recognized. Please show your registered face.')
        setTimeout(() => {
          verificationCooldownRef.current = false
          setVerificationMessage('')
        }, 1500)
      }
    }).catch(() => {})
  }, [isVerifying, professorId])

  const performFaceVerification = async (descriptors: Float32Array[]) => {
    try {
      setIsVerifying(true)
      setVerificationStatus('scanning')
      
      // Validate we have enough captures
      if (descriptors.length < REQUIRED_CAPTURES) {
        console.error('❌ Not enough captures:', descriptors.length, '(expected', REQUIRED_CAPTURES, ')')
        setVerificationStatus('failed')
        setVerificationMessage(`Please hold still. Capturing ${descriptors.length}/${REQUIRED_CAPTURES}...`)
        setTimeout(() => {
          setVerificationStatus('idle')
          setVerificationMessage('')
        }, 1500)
        setIsVerifying(false)
        return
      }

      // Validate all descriptors are correct length (keras-facenet 512D)
      for (const descriptor of descriptors) {
        if (!descriptor || descriptor.length !== 512) {
          console.error('❌ Invalid face descriptor:', descriptor?.length, '(expected 512)')
          setVerificationStatus('failed')
          setVerificationMessage('Face detection failed. Please try again.')
          setCapturedDescriptors([])
          capturedDescriptorsRef.current = []
          setTimeout(() => {
            setVerificationStatus('idle')
            setVerificationMessage('')
          }, 2000)
          setIsVerifying(false)
          return
        }
      }
      
      // CRITICAL: Check that captures are sufficiently different
      const similarities = []
      for (let i = 0; i < descriptors.length - 1; i++) {
        for (let j = i + 1; j < descriptors.length; j++) {
          let similarity = 0
          for (let k = 0; k < 512; k++) {
            similarity += Math.abs(descriptors[i][k] - descriptors[j][k])
          }
          similarities.push(similarity)
        }
      }
      const avgDifference = similarities.reduce((a, b) => a + b, 0) / similarities.length
      
      console.log('📸 Capture diversity check:', avgDifference.toFixed(4), '(min required: 0.5)')
      
      if (avgDifference < 0.5) {
        console.error('🚨 SECURITY ALERT: Captures are too similar - possible photo attack')
        setVerificationStatus('failed')
        setVerificationMessage('Suspicious activity detected. Please move your head naturally during capture.')
        setCapturedDescriptors([])
        capturedDescriptorsRef.current = []
        setTimeout(() => {
          setVerificationStatus('idle')
          setVerificationMessage('')
        }, 3000)
        setIsVerifying(false)
        return
      }

      // Since all captures were already verified in real-time, we just need to confirm
      console.log('🎯 All', descriptors.length, 'captures already verified in real-time')
      console.log(`   - Capture diversity: ${avgDifference.toFixed(4)} ✅`)

      setVerificationStatus('success')
      setVerificationMessage('Live face verified! Accessing class...')
      
      // Stop camera and cleanup resources
      stopCamera()
      
      setTimeout(() => {
        onVerificationSuccess()
      }, 1500)
    } catch (error) {
      console.error('Verification error:', error)
      setVerificationStatus('failed')
      setVerificationMessage('Verification error. Please try again.')
      setCapturedDescriptors([])
      setTimeout(() => {
        setVerificationStatus('idle')
        setVerificationMessage('')
      }, 2000)
    } finally {
      setIsVerifying(false)
    }
  }

  const startCamera = async () => {
    if (!modelsLoaded) {
      alert('Face recognition server loading...')
      return
    }

    try {
      const stream = new ServerCameraStream()
      serverStreamRef4.current = stream
      stream.start('extract', handleServerFrame4, (err) => {
        console.error('Server camera error:', err)
      })
      setShowCamera(true)
    } catch (error) {
      console.error('Camera error:', error)
      alert('Unable to connect to camera server.')
    }
  }

  const stopCamera = () => {
    if (serverStreamRef4.current) {
      serverStreamRef4.current.stop()
      serverStreamRef4.current = null
    }
    setShowCamera(false)
    setFaceDetected(false)
    setCapturedDescriptors([])
    capturedDescriptorsRef.current = []
    resetLiveness()
  }

  const handleCancel = () => {
    stopCamera()
    if (onCancel) {
      onCancel()
    } else {
      router.push('/professor')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="p-8 text-center border-b border-gray-100">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Verify Your Identity</h2>
          <p className="mt-2 text-sm text-gray-500">Live face verification required to access the class session</p>
        </div>
        
        <div className="p-8 space-y-6">
          {!showCamera ? (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-gray-700" />
                    <span className="font-semibold text-gray-900 text-sm">Security Notice</span>
                  </div>
                  <ul className="text-sm text-gray-600 space-y-2 ml-7 list-disc">
                    <li>System will capture 3 different frames</li>
                    <li>Move your head slightly during capture</li>
                    <li>Photos and static images will be rejected</li>
                    <li>All captures must match your registered face</li>
                  </ul>
                </div>
              </div>
              <Button onClick={startCamera} className="w-full h-12 text-base font-medium rounded-xl gap-2 transition-all bg-black hover:bg-gray-800 text-white" disabled={!modelsLoaded}>
                {!modelsLoaded ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Loading Models...</>
                ) : (
                  <><Camera className="w-5 h-5" /> Start Live Verification</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="relative bg-black rounded-2xl overflow-hidden shadow-inner ring-1 ring-gray-900/5 aspect-[4/3] flex items-center justify-center">
                <canvas
                  ref={serverCanvasRef4}
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                
                {/* Camera Guide Overlay */}
                <div className="absolute inset-0 pointer-events-none p-6 flex items-center justify-center">
                   <div className="w-48 h-64 border-2 border-white/30 rounded-full border-dashed animate-pulse" />
                </div>
                
                {!faceDetected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-all duration-300">
                    <div className="text-center text-white flex flex-col items-center">
                      <ScanFace className="w-10 h-10 animate-bounce mb-3 opacity-80" />
                      <p className="text-sm font-medium">Position your face in frame</p>
                    </div>
                  </div>
                )}

                {verificationStatus === 'scanning' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-all duration-300">
                    <div className="text-center text-white flex flex-col items-center">
                      <Loader2 className="w-10 h-10 animate-spin mb-3 text-emerald-400" />
                      <p className="text-sm font-medium">Verifying captures...</p>
                    </div>
                  </div>
                )}

                {verificationStatus === 'success' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/90 backdrop-blur-sm transition-all duration-300">
                    <div className="text-center text-white flex flex-col items-center scale-in-center">
                      <div className="bg-white/20 p-3 rounded-full mb-3">
                        <Check className="w-10 h-10" />
                      </div>
                      <p className="text-base font-bold tracking-tight">{verificationMessage}</p>
                    </div>
                  </div>
                )}

                {verificationStatus === 'failed' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-500/90 backdrop-blur-sm transition-all duration-300">
                    <div className="text-center text-white flex flex-col items-center">
                      <div className="bg-white/20 p-3 rounded-full mb-3">
                        <X className="w-10 h-10" />
                      </div>
                      <p className="text-base font-bold tracking-tight">{verificationMessage}</p>
                    </div>
                  </div>
                )}

                <div className="absolute top-4 inset-x-0 flex flex-col items-center pointer-events-none gap-2">
                  {/* Capture Progress */}
                  {capturedDescriptors.length < REQUIRED_CAPTURES && faceDetected && verificationStatus === 'idle' && (
                    <div className="bg-blue-600/90 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2">
                      <Camera className="w-4 h-4" /> 
                      Capturing {capturedDescriptors.length}/{REQUIRED_CAPTURES}
                    </div>
                  )}
                  
                  {/* Captures Complete - Verifying */}
                  {capturedDescriptors.length >= REQUIRED_CAPTURES && verificationStatus === 'scanning' && (
                    <div className="bg-amber-600/90 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Verifying Captures...
                    </div>
                  )}
                  
                  {/* Verification Success */}
                  {verificationStatus === 'success' && (
                    <div className="bg-emerald-600/90 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2">
                      <Check className="w-4 h-4" /> Verified! Redirecting...
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleCancel}
                  variant="outline"
                  className="w-full h-12 rounded-xl border-gray-200 text-gray-700 hover:bg-gray-50"
                  disabled={isVerifying}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
