'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, Loader2, Camera, RefreshCw, Check, X, ShieldCheck, Clock, Users, Plus } from 'lucide-react'
import * as faceapi from 'face-api.js'
import { usePassiveLivenessDetection } from '@/hooks/usePassiveLivenessDetection'

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
  const sectionId = params.sectionId as string

  const [checkingRegistration, setCheckingRegistration] = useState(true)
  const [isRegistered, setIsRegistered] = useState(false)
  const [showStudentRegModal, setShowStudentRegModal] = useState(false)
  const [showFaceRecognitionModal, setShowFaceRecognitionModal] = useState(false)
  const [mergedAttendanceData, setMergedAttendanceData] = useState<any[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'professor' && user.role !== 'adviser'))) {
      router.push('/professor/login')
      return
    }

    if (!loading && user) {
      checkFaceRegistration()
      fetchTodayAttendanceRecords()
    }
  }, [user, loading, router])

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
        // This is now just for reference, the actual display uses mergedAttendanceData from records API
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

  // If not registered, show registration modal
  if (!isRegistered) {
    return (
      <FaceRegistrationModal
        professorId={user?.id || ''}
        professorName={`${user?.firstName} ${user?.lastName}`}
        onComplete={handleRegistrationComplete}
        onSkip={() => setIsRegistered(true)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50/50">
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
          <Button onClick={() => setShowFaceRecognitionModal(true)} className="gap-2 font-medium">
            <Camera className="h-4 w-4" />
            Mark Attendance
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowStudentRegModal(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Register Student
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-6xl py-8 space-y-8 px-6">
        {/* Status Indicators */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
               <CardTitle className="text-sm font-medium">Today's Date</CardTitle>
               <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
               <p className="text-xs text-muted-foreground mt-1">
                Daily attendance tracking
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
               <CardTitle className="text-sm font-medium">Attendees</CardTitle>
               <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {mergedAttendanceData.filter(s => s.status !== 'absent').length} / {mergedAttendanceData.length}
              </div>
               <p className="text-xs text-muted-foreground mt-1">
                Students present or late
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Attendance List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
             <div>
               <h2 className="text-lg font-semibold tracking-tight">Attendance Log</h2>
               <p className="text-xs text-muted-foreground mt-1">
                 {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
               </p>
             </div>
          </div>
          
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
        </div>
      </main>

      {/* Student Registration Modal */}
      {showStudentRegModal && (
        <StudentRegistrationModal
          sectionId={sectionId}
          onClose={() => setShowStudentRegModal(false)}
          onRegistrationSuccess={() => {
            setShowStudentRegModal(false)
            fetchRegisteredStudents()
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
  const [livenessComplete, setLivenessComplete] = useState(false)
  const [livenessScore, setLivenessScore] = useState(0)
  const [livenessMetrics, setLivenessMetrics] = useState({
    eyesOpen: false,
    faceDetected: false,
    headMovement: false,
    livenessScore: 0
  })
  const [credentials, setCredentials] = useState<StudentCredentials | null>(null)
  const [validationErrors, setValidationErrors] = useState<{
    studentId?: string
    email?: string
  }>({})
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [checkingStudentId, setCheckingStudentId] = useState(false)

  const { livenessScore: hookLivenessScore, livenessMetrics: hookLivenessMetrics, updateLivenessScore, resetLiveness } = usePassiveLivenessDetection()

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Sync hook values to component state
  useEffect(() => {
    setLivenessScore(hookLivenessScore)
    setLivenessMetrics(hookLivenessMetrics)
  }, [hookLivenessScore, hookLivenessMetrics])

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
    const loadModels = async () => {
      try {
        const MODEL_URL = '/models'
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ])
        setModelsLoaded(true)
      } catch (error) {
        console.error('Error loading face-api models:', error)
      }
    }
    loadModels()
  }, [])

  useEffect(() => {
    if (!showCamera || !streamRef.current || !videoRef.current) return

    // Assign stream to video element
    videoRef.current.srcObject = streamRef.current
    
    // Try to play the video
    const playPromise = videoRef.current.play()
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.error('Autoplay failed, retrying...', err)
        // Retry with a small delay
        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.play().catch(e => console.error('Retry failed:', e))
          }
        }, 100)
      })
    }

    // Start face detection
    startFaceDetection()

    // Cleanup function
    return () => {
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [showCamera])

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isCapturing) return

      try {
        const detection = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor()

        if (detection) {
          setFaceDetected(true)
          setFaceDescriptor(detection.descriptor)

          if (!livenessComplete) {
            const isLive = updateLivenessScore(detection)
            if (isLive) {
              setLivenessComplete(true)
            }
          }
        } else {
          setFaceDetected(false)
          setFaceDescriptor(null)
          resetLiveness()
        }
      } catch (error) {
        console.error('Face detection error:', error)
      }
    }, 300)
  }

  const startCamera = async () => {
    if (!modelsLoaded) {
      alert('Models loading...')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      
      // Store stream reference BEFORE showing camera
      streamRef.current = stream
      
      // Small delay to ensure video element is mounted
      requestAnimationFrame(() => {
        setShowCamera(true)
      })
    } catch (error: any) {
      alert(`Camera error: ${error.message}`)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    setShowCamera(false)
    setIsCapturing(false)
    setFaceDetected(false)
    setFaceDescriptor(null)
    setLivenessComplete(false)
    setLivenessScore(0)
    setLivenessMetrics({
      eyesOpen: false,
      faceDetected: false,
      headMovement: false,
      livenessScore: 0
    })
    resetLiveness()
  }

  const capturePhoto = () => {
    if (videoRef.current && !isCapturing && faceDescriptor) {
      setIsCapturing(true)
      const canvas = document.createElement('canvas')
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(videoRef.current, 0, 0)
        setCapturedImage(canvas.toDataURL('image/jpeg', 0.9))
        stopCamera()
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
      const descriptorArray = faceDescriptor ? Array.from(faceDescriptor) : null

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
      <Card className="w-full max-w-lg shadow-xl border-border/40 max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Register New Student</CardTitle>
          <CardDescription>
            Create a student account with facial recognition
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <div className="p-6 pt-0 space-y-6">
            {/* Personal Information */}
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

            {/* Photo Verification */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Photo Verification</h3>

              {!showCamera && !capturedImage && (
                <div className="border border-dashed rounded-lg p-8 flex flex-col items-center justify-center bg-muted/30 hover:bg-muted/50 transition-colors">
                  <ShieldCheck className="h-10 w-10 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
                    Liveness detection enabled. You will be asked to move your head slightly.
                  </p>
                  <Button type="button" onClick={startCamera}>
                    Start Camera
                  </Button>
                </div>
              )}

              {showCamera && (
                <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover transform scale-x-[-1]"
                  />

                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={`w-48 h-64 border-2 rounded-full transition-colors duration-300 ${
                      faceDetected ? 'border-primary' : 'border-white/30'
                    }`} />
                  </div>

                  <div className="absolute top-4 inset-x-0 flex flex-col items-center pointer-events-none gap-2">
                    {!livenessComplete ? (
                      <div className="bg-black/80 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md">
                        📍 Look at camera - ensure good lighting
                      </div>
                    ) : (
                      <div className="bg-emerald-600/90 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2">
                        <Check className="w-4 h-4" /> Liveness Verified
                      </div>
                    )}

                    {faceDetected && livenessScore > 0 && livenessScore < 100 && (
                      <div className="mt-1 w-32 h-1 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all duration-100" style={{ width: `${livenessScore}%` }} />
                      </div>
                    )}
                  </div>

                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/70 backdrop-blur-sm rounded-lg p-3 flex flex-col gap-2 text-xs">
                    <div className="text-white font-bold mb-1">Liveness Metrics</div>
                    <div className={`flex items-center gap-2 ${livenessMetrics.faceDetected ? 'text-blue-400' : 'text-gray-400'}`}>
                      <div className={`w-2 h-2 rounded-full ${livenessMetrics.faceDetected ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                      <span>Face Detected</span>
                    </div>
                    <div className={`flex items-center gap-2 ${livenessMetrics.eyesOpen ? 'text-blue-400' : 'text-gray-400'}`}>
                      <div className={`w-2 h-2 rounded-full ${livenessMetrics.eyesOpen ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                      <span>Eyes Open</span>
                    </div>
                    <div className={`flex items-center gap-2 ${livenessMetrics.headMovement ? 'text-blue-400' : 'text-gray-400'}`}>
                      <div className={`w-2 h-2 rounded-full ${livenessMetrics.headMovement ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                      <span>Head Movement</span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-600">
                      <div className="text-blue-400 font-bold">Liveness: {Math.round(livenessScore)}%</div>
                    </div>
                  </div>

                  <div className="absolute bottom-4 inset-x-0 flex justify-center gap-4 px-4 z-10">
                    <Button type="button" variant="destructive" size="sm" onClick={stopCamera}>
                      Cancel
                    </Button>
                    {livenessComplete && faceDetected && (
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
                      setLivenessComplete(false)
                      setLivenessScore(0)
                      setLivenessMetrics({
                        eyesOpen: false,
                        faceDetected: false,
                        headMovement: false,
                        livenessScore: 0
                      })
                      resetLiveness()
                      startCamera()
                    }}>
                      <RefreshCw className="w-4 h-4 mr-2" /> Retake
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
  const [faceDetected, setFaceDetected] = useState(false)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  const [recognizingStudent, setRecognizingStudent] = useState<any>(null)
  const [recognitionError, setRecognitionError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = '/models'
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ])
        setModelsLoaded(true)
      } catch (error) {
        console.error('Error loading face-api models:', error)
      }
    }
    loadModels()
  }, [])

  const startCamera = async () => {
    if (!modelsLoaded) {
      setRecognitionError('Facial recognition models are still loading...')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      
      // Store stream reference BEFORE showing camera
      streamRef.current = stream
      setRecognitionError(null)
      
      // Use requestAnimationFrame to ensure video element is mounted
      requestAnimationFrame(() => {
        setShowCamera(true)
      })
    } catch (error: any) {
      setRecognitionError(`Camera error: ${error.message}`)
    }
  }

  // Handle stream attachment when camera is shown
  useEffect(() => {
    if (!showCamera || !streamRef.current || !videoRef.current) return

    // Assign stream to video element
    videoRef.current.srcObject = streamRef.current
    
    // Try to play the video
    const playPromise = videoRef.current.play()
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.error('Autoplay failed, retrying...', err)
        // Retry with a small delay
        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.play().catch(e => console.error('Retry failed:', e))
          }
        }, 100)
      })
    }

    // Start face detection
    startFaceDetection()

    // Cleanup function
    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current)
      }
    }
  }, [showCamera])

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    setShowCamera(false)
    setFaceDetected(false)
    setFaceDescriptor(null)
  }

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isProcessing) return

      try {
        const detection = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor()

        if (detection) {
          setFaceDetected(true)
          setFaceDescriptor(detection.descriptor)

          // Auto-match face when detected
          if (!isProcessing && detection.descriptor) {
            await matchAndMarkAttendance(detection.descriptor)
          }
        } else {
          setFaceDetected(false)
          setRecognitionError(null)
        }
      } catch (error) {
        // Face detection error
      }
    }, 500)
  }

  const matchAndMarkAttendance = async (descriptor: Float32Array) => {
    if (isProcessing || recognizingStudent) return
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
        setRecognitionError('Face not recognized. Try again.')
        setIsProcessing(false)
        return
      }

      const student = matchData.student
      setRecognizingStudent(student)

      // Mark attendance (backend will create/use today's session automatically)
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
        setRecognitionError(null)
        // Wait for records to be refetched, then close modal
        await onStudentMarked()
        // Small delay to ensure data is merged before closing
        setTimeout(() => {
          onClose()
          setRecognizingStudent(null)
          setIsProcessing(false)
        }, 500)
      } else {
        setRecognitionError('Failed to mark attendance')
        setIsProcessing(false)
      }
    } catch (error: any) {
      setRecognitionError(error.message || 'Error processing attendance')
      setIsProcessing(false)
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
              Face recognition in progress. {recognizingStudent ? 'Student recognized!' : 'Position your face in the camera.'}
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
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                />
                
                {recognizingStudent && (
                  <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center z-10">
                    <div className="text-center">
                      <Check className="h-16 w-16 text-emerald-400 mx-auto mb-2" />
                      <p className="text-white font-semibold text-lg">{recognizingStudent.firstName} {recognizingStudent.lastName}</p>
                      <p className="text-emerald-100 text-sm">Attendance marked successfully</p>
                    </div>
                  </div>
                )}

                {recognitionError && !recognizingStudent && (
                  <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center z-10">
                    <div className="text-center">
                      <X className="h-12 w-12 text-red-400 mx-auto mb-2" />
                      <p className="text-white font-semibold">{recognitionError}</p>
                    </div>
                  </div>
                )}

                {faceDetected && !recognizingStudent && (
                  <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm">
                    <div className="h-2 w-2 bg-white rounded-full animate-pulse" />
                    Face detected
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
}

type LivenessStep = 'center' | 'left' | 'right' | 'up' | 'complete'

interface LivenessProgress {
  center: boolean
  left: boolean
  right: boolean
  up: boolean
  rotate: boolean
}

function FaceRegistrationModal({ professorId, professorName, onComplete, onSkip }: FaceRegistrationModalProps) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: ''
  })
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  const [livenessCheck, setLivenessCheck] = useState(true)
  const [livenessComplete, setLivenessComplete] = useState(false)
  const [livenessScore, setLivenessScore] = useState(0)
  const [livenessMetrics, setLivenessMetrics] = useState({
    eyesOpen: false,
    faceDetected: false,
    headMovement: false,
    livenessScore: 0
  })
  
  const { livenessScore: hookLivenessScore, livenessMetrics: hookLivenessMetrics, updateLivenessScore, resetLiveness } = usePassiveLivenessDetection()
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Sync hook values to component state
  useEffect(() => {
    setLivenessScore(hookLivenessScore)
    setLivenessMetrics(hookLivenessMetrics)
  }, [hookLivenessScore, hookLivenessMetrics])

  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = '/models'
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ])
        setModelsLoaded(true)
      } catch (error) {
        console.error('Error loading face-api models:', error)
      }
    }
    loadModels()
  }, [])

  useEffect(() => {
    if (!showCamera || !streamRef.current || !videoRef.current) return

    // Assign stream to video element
    videoRef.current.srcObject = streamRef.current
    
    // Try to play the video
    const playPromise = videoRef.current.play()
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.error('Autoplay failed, retrying...', err)
        // Retry with a small delay
        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.play().catch(e => console.error('Retry failed:', e))
          }
        }, 100)
      })
    }

    // Start face detection
    startFaceDetection()

    // Cleanup function
    return () => {
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [showCamera])

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isCapturing) return

      try {
        const detection = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor()

        if (detection) {
          setFaceDetected(true)
          setFaceDescriptor(detection.descriptor)
          
          if (livenessCheck && !livenessComplete) {
            const isLive = updateLivenessScore(detection)
            if (isLive) {
              setLivenessComplete(true)
            }
          }
        } else {
          setFaceDetected(false)
          setFaceDescriptor(null)
          resetLiveness()
        }
      } catch (error) {
        console.error('Face detection error:', error)
      }
    }, 300)
  }

  const startCamera = async () => {
    if (!modelsLoaded) {
      alert('Models loading...')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      
      // Store stream reference BEFORE showing camera
      streamRef.current = stream
      
      // Small delay to ensure video element is mounted
      requestAnimationFrame(() => {
        setShowCamera(true)
      })
    } catch (error: any) {
      alert(`Camera error: ${error.message}`)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    setShowCamera(false)
    setIsCapturing(false)
    setFaceDetected(false)
    setFaceDescriptor(null)
    setLivenessComplete(false)
    setLivenessScore(0)
    setLivenessMetrics({
      eyesOpen: false,
      faceDetected: false,
      headMovement: false,
      livenessScore: 0
    })
    resetLiveness()
  }

  const capturePhoto = () => {
    if (videoRef.current && !isCapturing && faceDescriptor) {
      setIsCapturing(true)
      const canvas = document.createElement('canvas')
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(videoRef.current, 0, 0)
        setCapturedImage(canvas.toDataURL('image/jpeg', 0.9))
        stopCamera()
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.firstName || !formData.lastName || !capturedImage) return

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/professor/face-registration/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          professorId,
          firstName: formData.firstName,
          lastName: formData.lastName,
          faceData: capturedImage,
          faceDescriptor: faceDescriptor ? Array.from(faceDescriptor) : null
        })
      })

      const data = await response.json()
      if (data.success) {
        onComplete()
      } else {
        alert(data.error || 'Failed to register')
      }
    } catch (error) {
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
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover transform scale-x-[-1]"
                      />
                      
                      {/* Minimalist Overlay */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className={`w-48 h-64 border-2 rounded-full transition-colors duration-300 ${
                           faceDetected ? 'border-primary' : 'border-white/30'
                        }`} />
                      </div>

                      {/* Instructions */}
                      <div className="absolute top-4 inset-x-0 flex flex-col items-center pointer-events-none gap-2">
                         {!livenessComplete ? (
                           <div className="bg-black/80 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md">
                             📍 Look at camera - ensure good lighting
                           </div>
                         ) : (
                           <div className="bg-emerald-600/90 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2">
                             <Check className="w-4 h-4" /> Liveness Verified
                           </div>
                         )}
                         
                         {faceDetected && livenessScore > 0 && livenessScore < 100 && (
                           <div className="mt-1 w-32 h-1 bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full bg-primary transition-all duration-100" style={{ width: `${livenessScore}%` }} />
                           </div>
                         )}
                      </div>

                      {/* Liveness Metrics */}
                      <div className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/70 backdrop-blur-sm rounded-lg p-3 flex flex-col gap-2 text-xs">
                        <div className="text-white font-bold mb-1">Liveness Metrics</div>
                        <div className={`flex items-center gap-2 ${livenessMetrics.faceDetected ? 'text-blue-400' : 'text-gray-400'}`}>
                          <div className={`w-2 h-2 rounded-full ${livenessMetrics.faceDetected ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                          <span>Face Detected</span>
                        </div>
                        <div className={`flex items-center gap-2 ${livenessMetrics.eyesOpen ? 'text-blue-400' : 'text-gray-400'}`}>
                          <div className={`w-2 h-2 rounded-full ${livenessMetrics.eyesOpen ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                          <span>Eyes Open</span>
                        </div>
                        <div className={`flex items-center gap-2 ${livenessMetrics.headMovement ? 'text-blue-400' : 'text-gray-400'}`}>
                          <div className={`w-2 h-2 rounded-full ${livenessMetrics.headMovement ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                          <span>Head Movement</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-600">
                          <div className="text-blue-400 font-bold">Liveness: {Math.round(livenessScore)}%</div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="absolute bottom-4 inset-x-0 flex justify-center gap-4 px-4 z-10">
                         <Button type="button" variant="destructive" size="sm" onClick={stopCamera}>
                           Cancel
                         </Button>
                         {livenessComplete && faceDetected && (
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
                            setLivenessComplete(false)
                            setLivenessScore(0)
                            setLivenessMetrics({
                              eyesOpen: false,
                              faceDetected: false,
                              headMovement: false,
                              livenessScore: 0
                            })
                            resetLiveness()
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
              {onSkip && (
                <Button type="button" variant="ghost" onClick={onSkip} className="mr-2">Skip</Button>
              )}
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
