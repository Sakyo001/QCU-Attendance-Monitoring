'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, Loader2, Camera, RefreshCw, Check, X, ShieldCheck, Clock, Users, Plus, LayoutGrid, List, Monitor } from 'lucide-react'
import { initializeFaceDetection, detectFaceInVideo } from '@/lib/mediapipe-face'
import { extractFaceNetFromVideo, checkFaceNetHealth } from '@/lib/facenet-python-api'
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
  const searchParams = useSearchParams()
  const sectionId = params.sectionId as string
  const entryMethod = searchParams.get('entryMethod') || 'face' // Default to face if not specified
  const urlToken = searchParams.get('token') // Verification token for password entry

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
  const [newStudentNotification, setNewStudentNotification] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'professor' && (user.role as any) !== 'adviser'))) {
      router.push('/professor/login')
      return
    }

    if (!loading && user) {
      // Verify password entry token if using password method
      if (entryMethod === 'password') {
        const storedToken = sessionStorage.getItem(`class-access-${sectionId}`)
        if (storedToken && storedToken === urlToken) {
          // Valid token, mark as password verified
          setPasswordVerified(true)
          setFaceVerified(true) // Allow access
          setCheckingRegistration(false)
          // Clear the token to prevent reuse
          sessionStorage.removeItem(`class-access-${sectionId}`)
        } else {
          // Invalid or missing token, redirect back
          console.error('Invalid or missing password verification token')
          router.push('/professor')
          return
        }
      } else if (entryMethod === 'face') {
        // Only check face registration if using face entry method
        checkFaceRegistration()
      } else {
        // Unknown entry method, default to face
        setCheckingRegistration(false)
      }
      fetchTodayAttendanceRecords()
    }
  }, [user, loading, router, entryMethod, urlToken, sectionId])

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

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceStableStartRef = useRef<number | null>(null)
  const consecutiveFaceDetectionsRef = useRef<number>(0)
  const autoCaptureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const savedFaceDescriptorRef = useRef<Float32Array | null>(null) // Permanent storage for captured descriptor

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

  // Canvas drawing effect for bounding box
  useEffect(() => {
    if (!showCamera || !canvasRef.current || !videoRef.current) return

    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawFrame = () => {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (boundingBox) {
        const { x, y, width, height } = boundingBox
        
        // Draw bounding box
        ctx.strokeStyle = '#10b981'
        ctx.lineWidth = 3
        ctx.strokeRect(x, y, width, height)
        
        // Draw corner markers
        const cornerLength = 30
        ctx.lineCap = 'round'
        
        // Top-left
        ctx.beginPath()
        ctx.moveTo(x, y + cornerLength)
        ctx.lineTo(x, y)
        ctx.lineTo(x + cornerLength, y)
        ctx.stroke()
        
        // Top-right
        ctx.beginPath()
        ctx.moveTo(x + width - cornerLength, y)
        ctx.lineTo(x + width, y)
        ctx.lineTo(x + width, y + cornerLength)
        ctx.stroke()
        
        // Bottom-left
        ctx.beginPath()
        ctx.moveTo(x, y + height - cornerLength)
        ctx.lineTo(x, y + height)
        ctx.lineTo(x + cornerLength, y + height)
        ctx.stroke()
        
        // Bottom-right
        ctx.beginPath()
        ctx.moveTo(x + width - cornerLength, y + height)
        ctx.lineTo(x + width, y + height)
        ctx.lineTo(x + width, y + height - cornerLength)
        ctx.stroke()
        
        // Draw name label if recognized
        if (recognizedName) {
          const labelText = recognitionConfidence !== null 
            ? `${recognizedName} (${Math.round(recognitionConfidence * 100)}%)`
            : recognizedName
          
          ctx.font = '18px sans-serif'
          const textWidth = ctx.measureText(labelText).width
          const padding = 10
          const labelHeight = 30
          
          // Background
          ctx.fillStyle = 'rgba(16, 185, 129, 0.9)'
          ctx.fillRect(x, y - labelHeight - 5, textWidth + padding * 2, labelHeight)
          
          // Text
          ctx.fillStyle = 'white'
          ctx.fillText(labelText, x + padding, y - 12)
        }
      }

      requestAnimationFrame(drawFrame)
    }

    drawFrame()
  }, [showCamera, boundingBox, recognizedName, recognitionConfidence])

  useEffect(() => {
    const loadModels = async () => {
      try {
        const loaded = await initializeFaceDetection()
        setModelsLoaded(loaded)
        if (loaded) {
          console.log('✅ MediaPipe models loaded for Student Registration')
        }
      } catch (error) {
        console.error('Error loading MediaPipe:', error)
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
      if (autoCaptureTimeoutRef.current) clearTimeout(autoCaptureTimeoutRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [showCamera])

  const recognizeFace = async (descriptor: Float32Array) => {
    try {
      const response = await fetch('/api/attendance/match-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faceDescriptor: Array.from(descriptor) })
      })
      const data = await response.json()
      
      if (data.success && data.matched) {
        setRecognizedName(`${data.student.first_name} ${data.student.last_name}`)
        setRecognitionConfidence(data.confidence)
      } else {
        setRecognizedName('Unknown')
        setRecognitionConfidence(null)
      }
    } catch (error) {
      console.error('Recognition error:', error)
      setRecognizedName(null)
      setRecognitionConfidence(null)
    }
  }

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isCapturing) return

      try {
        // Extract embedding via Python server (512D)
        const pythonResult = await extractFaceNetFromVideo(videoRef.current)

        if (pythonResult.detected && pythonResult.embedding) {
          setFaceDetected(true)
          const descriptor = new Float32Array(pythonResult.embedding)
          setFaceDescriptor(descriptor)
          
          // IMPORTANT: Save to ref IMMEDIATELY when detected (not just during capture)
          savedFaceDescriptorRef.current = descriptor
          console.log('✅ Face detected! Descriptor length:', descriptor.length, '- Saved to ref')
          console.log('   Confidence:', pythonResult.confidence?.toFixed(3))
          
          // REAL-TIME CHECK: Verify if face already exists in database
          const matchResponse = await fetch('/api/attendance/match-face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ faceDescriptor: Array.from(descriptor) })
          })
          const matchData = await matchResponse.json()
          
          if (matchData.success && matchData.matched) {
            setRecognizedName(`${matchData.student.first_name} ${matchData.student.last_name}`)
            setRecognitionConfidence(matchData.confidence)
            console.log(`⚠️ Face already registered: ${matchData.student.first_name} ${matchData.student.last_name}`)
          } else {
            setRecognizedName('New Student')
            setRecognitionConfidence(null)
            console.log('✅ New face detected - not in database')
          }
          
          setBoundingBox(null) // Remove bounding box since Python server doesn't provide it
          
          // Auto-capture logic - ULTRA LENIENT
          consecutiveFaceDetectionsRef.current += 1
          
          if (autoCapture && !isCapturing && consecutiveFaceDetectionsRef.current >= 1) {
            if (!faceStableStartRef.current) {
              faceStableStartRef.current = Date.now()
            }
            
            const CAPTURE_DELAY = 1200 // 1.2 seconds
            const elapsed = Date.now() - faceStableStartRef.current
            const remaining = Math.max(0, CAPTURE_DELAY - elapsed)
            const countdownValue = Math.ceil(remaining / 1000)
            
            setCaptureCountdown(countdownValue)
            
            if (elapsed >= CAPTURE_DELAY) {
              capturePhoto()
            }
          }
        } else {
          setFaceDetected(false)
          setBoundingBox(null)
          setRecognizedName(null)
          setRecognitionConfidence(null)
          
          // Ultra-lenient forgiveness: slow decay, reset after many misses
          consecutiveFaceDetectionsRef.current = Math.max(0, consecutiveFaceDetectionsRef.current - 0.25)
          
          if (consecutiveFaceDetectionsRef.current < 0.1) {
            consecutiveFaceDetectionsRef.current = 0
            faceStableStartRef.current = null
            setCaptureCountdown(null)
          }
        }
      } catch (error) {
        console.error('Face detection error:', error)
      }
    }, 300)
  }

  const startCamera = async () => {
    if (!modelsLoaded) {
      alert('MediaPipe models loading...')
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
    // NOTE: Don't clear savedFaceDescriptorRef - it must persist for submission!
    
    faceStableStartRef.current = null
    consecutiveFaceDetectionsRef.current = 0
  }

  const capturePhoto = () => {
    console.log('📸 Attempting to capture photo...')
    console.log('   - Face descriptor in state:', !!faceDescriptor, faceDescriptor?.length)
    console.log('   - Face descriptor in ref:', !!savedFaceDescriptorRef.current, savedFaceDescriptorRef.current?.length)
    console.log('   - Face detected flag:', faceDetected)
    
    // Use descriptor from state OR ref
    const descriptorToCheck = faceDescriptor || savedFaceDescriptorRef.current
    
    // CRITICAL: Prevent capture if no face descriptor exists
    if (!descriptorToCheck) {
      console.error('❌ Cannot capture: No face descriptor detected')
      console.error('   State descriptor:', faceDescriptor)
      console.error('   Ref descriptor:', savedFaceDescriptorRef.current)
      alert('Face not detected! Please position your face clearly in the camera and wait for detection.')
      setIsCapturing(false)
      return
    }
    
    console.log('✅ Descriptor found! Proceeding with capture')
    
    if (videoRef.current && !isCapturing) {
      setIsCapturing(true)
      
      // IMPORTANT: Save descriptor to REF (permanent storage) BEFORE stopping camera
      const savedDescriptor = faceDescriptor
      if (savedDescriptor) {
        savedFaceDescriptorRef.current = savedDescriptor
        console.log('📋 Saved face descriptor to ref:', savedDescriptor.length, 'dimensions')
      } else {
        console.warn('⚠️ No face descriptor available at capture time!')
      }
      
      const canvas = document.createElement('canvas')
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(videoRef.current, 0, 0)
        setCapturedImage(canvas.toDataURL('image/jpeg', 0.9))
        console.log('✅ Photo captured successfully')
        
        // Stop camera after saving descriptor
        stopCamera()
        
        // Restore the saved descriptor to state after stopping camera
        if (savedDescriptor) {
          setFaceDescriptor(savedDescriptor)
        }
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
                  <ShieldCheck className="h-10 w-10 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
                    Position your face in the camera and ensure good lighting.
                  </p>
                  <Button type="button" onClick={startCamera}>
                    Start Camera
                  </Button>
                </div>
              )}

              {showCamera && (
                <div className="relative rounded-lg overflow-hidden bg-black" style={{ height: '500px' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover transform scale-x-[-1]"
                  />

                  {/* Canvas overlay for bounding box */}
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none transform scale-x-[-1]"
                  />

                  {/* Status indicators */}
                  <div className="absolute top-4 inset-x-0 flex flex-col items-center pointer-events-none gap-2">
                    <div className="bg-black/80 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md">
                      {autoCapture ? '⚡ Instant Auto-Capture Mode' : '📍 Look at camera'}
                    </div>
                    
                    {faceDetected && captureCountdown !== null && captureCountdown > 0 && (
                      <div className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-md animate-pulse">
                        Capturing...
                      </div>
                    )}
                    
                    {!faceDetected && (
                      <div className="bg-red-600/90 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-md">
                        No face detected
                      </div>
                    )}
                  </div>

                  {/* Cancel button only */}
                  <div className="absolute bottom-4 inset-x-0 flex justify-center gap-4 px-4 z-10">
                    <Button type="button" variant="destructive" size="sm" onClick={stopCamera}>
                      Cancel
                    </Button>
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
  const attendanceMarkedRef = useRef<boolean>(false) // Track if attendance already marked
  const lastRecognitionAttemptRef = useRef<number>(0) // Timestamp of last recognition attempt
  const recognitionCooldownRef = useRef<boolean>(false) // Cooldown after failed recognition

  useEffect(() => {
    const loadModels = async () => {
      try {
        const loaded = await initializeFaceDetection()
        setModelsLoaded(loaded)
        if (loaded) {
          console.log('✅ MediaPipe models loaded for Attendance Recognition')
        }
      } catch (error) {
        console.error('Error loading MediaPipe:', error)
      }
    }
    loadModels()
  }, [])

  const startCamera = async () => {
    if (!modelsLoaded) {
      setRecognitionError('MediaPipe models are still loading...')
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
        // Ignore play interruption errors (normal when component unmounts)
        if (err.name !== 'AbortError') {
          console.error('Autoplay failed, retrying...', err)
          // Retry with a small delay
          setTimeout(() => {
            if (videoRef.current && streamRef.current) {
              videoRef.current.play().catch(e => {
                if (e.name !== 'AbortError') console.error('Retry failed:', e)
              })
            }
          }, 100)
        }
      })
    }

    // Start face detection
    startFaceDetection()

    // Cleanup function
    return () => {
      // Pause video to prevent play() promise errors
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.srcObject = null
      }
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
      // CRITICAL: Check flags at the start of every interval
      if (!videoRef.current || isProcessing || attendanceMarkedRef.current || recognitionCooldownRef.current) {
        return
      }

      try {
        // Extract embedding via Python server (512D)
        const pythonResult = await extractFaceNetFromVideo(videoRef.current)

        if (pythonResult.detected && pythonResult.embedding) {
          setFaceDetected(true)
          const descriptor = new Float32Array(pythonResult.embedding)
          setFaceDescriptor(descriptor)
          
          console.log('✅ Face detected! Confidence:', pythonResult.confidence?.toFixed(3))

          // IMMEDIATE MATCH - No debouncing, just cooldown after failures
          if (!isProcessing && !attendanceMarkedRef.current && !recognitionCooldownRef.current) {
            // Stop interval BEFORE processing to prevent multiple calls
            if (detectionIntervalRef.current) {
              clearInterval(detectionIntervalRef.current)
              detectionIntervalRef.current = null
            }
            
            await matchAndMarkAttendance(descriptor)
          }
        } else {
          setFaceDetected(false)
        }
      } catch (error) {
        console.error('Face detection error:', error)
      }
    }, 800) // Increased to 800ms to reduce API spam
  }

  const matchAndMarkAttendance = async (descriptor: Float32Array) => {
    if (isProcessing || recognizingStudent || attendanceMarkedRef.current) {
      console.log('⏭️ Skipping - already processing or marked')
      return
    }
    
    console.log('🔍 Matching face...')
    setIsProcessing(true)
    attendanceMarkedRef.current = true // Set immediately to prevent any duplicates

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
        console.log('❌ Face not recognized')
        setRecognitionError('Face not recognized. Please try again.')
        setIsProcessing(false)
        attendanceMarkedRef.current = false // Reset so user can try again
        
        // Set cooldown after failed recognition (2 seconds)
        recognitionCooldownRef.current = true
        setTimeout(() => {
          recognitionCooldownRef.current = false
          setRecognitionError(null)
          // Restart detection interval for retry
          if (!detectionIntervalRef.current && showCamera) {
            startFaceDetection()
          }
        }, 2000)
        
        return
      }

      const student = matchData.student
      console.log('✅ Student matched:', student.firstName, student.lastName)
      setRecognizingStudent(student)

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
        console.log('✅ Attendance marked successfully!')
        setRecognitionError(null)
        
        // Stop camera immediately
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }
        
        // Wait for records refresh
        await onStudentMarked()
        
        // Close modal
        setTimeout(() => {
          setShowCamera(false)
          onClose()
          
          // Reset states for next use
          setRecognizingStudent(null)
          setIsProcessing(false)
          attendanceMarkedRef.current = false
          lastRecognitionAttemptRef.current = 0
        }, 1500)
      } else {
        console.log('❌ Failed to mark attendance')
        setRecognitionError('Failed to mark attendance')
        setIsProcessing(false)
        attendanceMarkedRef.current = false
        
        recognitionCooldownRef.current = true
        setTimeout(() => {
          recognitionCooldownRef.current = false
          setRecognitionError(null)
          if (!detectionIntervalRef.current && showCamera) {
            startFaceDetection()
          }
        }, 2000)
      }
    } catch (error: any) {
      console.error('❌ Error:', error)
      setRecognitionError(error.message || 'Error processing attendance')
      setIsProcessing(false)
      attendanceMarkedRef.current = false
      
      recognitionCooldownRef.current = true
      setTimeout(() => {
        recognitionCooldownRef.current = false
        setRecognitionError(null)
        if (!detectionIntervalRef.current && showCamera) {
          startFaceDetection()
        }
      }, 2000)
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
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const loadModels = async () => {
      try {
        const loaded = await initializeFaceDetection()
        setModelsLoaded(loaded)
        if (loaded) {
          console.log('✅ MediaPipe models loaded for Professor Registration')
        }
      } catch (error) {
        console.error('Error loading MediaPipe:', error)
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
        // Ignore play interruption errors (normal when component unmounts)
        if (err.name !== 'AbortError') {
          console.error('Autoplay failed, retrying...', err)
          // Retry with a small delay
          setTimeout(() => {
            if (videoRef.current && streamRef.current) {
              videoRef.current.play().catch(e => {
                if (e.name !== 'AbortError') console.error('Retry failed:', e)
              })
            }
          }, 100)
        }
      })
    }

    // Start face detection
    startFaceDetection()

    // Cleanup function
    return () => {
      // Pause video to prevent play() promise errors
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.srcObject = null
      }
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [showCamera])

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isCapturing) return

      try {
        const result = await detectFaceInVideo(videoRef.current)

        if (result.detected) {
          setFaceDetected(true)
          
          // Extract embedding via Python server (128D)
          const pythonResult = await extractFaceNetFromVideo(videoRef.current)
          if (pythonResult.detected && pythonResult.embedding) {
            setFaceDescriptor(new Float32Array(pythonResult.embedding))
            console.log('✅ Python FaceNet embedding:', pythonResult.embedding.length, 'dimensions')
            console.log('   Confidence:', pythonResult.confidence?.toFixed(3))
          } else {
            console.log('⚠️ Python extraction failed:', pythonResult.error)
          }
        } else {
          setFaceDetected(false)
          setFaceDescriptor(null)
        }
      } catch (error) {
        console.error('Face detection error:', error)
      }
    }, 300)
  }

  const startCamera = async () => {
    if (!modelsLoaded) {
      alert('MediaPipe models loading...')
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
  }

  const capturePhoto = () => {
    if (videoRef.current && !isCapturing && faceDescriptor) {
      setIsCapturing(true)
      
      // IMPORTANT: Save descriptor BEFORE stopping camera (which resets it)
      const savedDescriptor = faceDescriptor
      
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
        
        // Restore the saved descriptor after camera is stopped
        setFaceDescriptor(savedDescriptor)
        
        console.log('✅ Photo captured with face descriptor:', savedDescriptor.length, 'dimensions')
      }
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const capturedDescriptorsRef = useRef<Float32Array[]>([]) // Ref to avoid stale state in interval
  const verificationCooldownRef = useRef<boolean>(false) // Cooldown after failed verification
  const lastVerificationAttemptRef = useRef<number>(0) // Timestamp of last verification attempt

  useEffect(() => {
    const loadModels = async () => {
      try {
        const loaded = await initializeFaceDetection()
        setModelsLoaded(loaded)
        if (loaded) {
          console.log('✅ MediaPipe models loaded for Professor Verification')
        }
      } catch (error) {
        console.error('Error loading MediaPipe:', error)
      }
    }
    loadModels()
  }, [])

  useEffect(() => {
    if (!showCamera || !streamRef.current || !videoRef.current) return

    videoRef.current.srcObject = streamRef.current
    
    const playPromise = videoRef.current.play()
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        // Ignore play interruption errors (normal when component unmounts)
        if (err.name !== 'AbortError') {
          console.error('Autoplay failed, retrying...', err)
          setTimeout(() => {
            if (videoRef.current && streamRef.current) {
              videoRef.current.play().catch(e => {
                if (e.name !== 'AbortError') console.error('Retry failed:', e)
              })
            }
          }, 100)
        }
      })
    }

    startFaceDetection()

    return () => {
      // Pause video to prevent play() promise errors
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.srcObject = null
      }
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [showCamera])

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isVerifying || verificationCooldownRef.current) return

      try {
        const result = await detectFaceInVideo(videoRef.current)

        if (result.detected) {
          setFaceDetected(true)
          
          // Extract embedding via Python server (512D)
          const pythonResult = await extractFaceNetFromVideo(videoRef.current)
          
          if (pythonResult.detected && pythonResult.embedding) {
            const descriptor = new Float32Array(pythonResult.embedding)
            setFaceDescriptor(descriptor)
            
            // REAL-TIME VERIFICATION: Check if this face matches BEFORE counting the capture
            const response = await fetch('/api/professor/face-registration/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                professorId,
                faceDescriptor: Array.from(descriptor)
              })
            })

            const verifyData = await response.json()
            const isMatch = verifyData.success && verifyData.verified
            console.log(`🔍 Real-time check: ${isMatch ? '✅ MATCH' : '❌ NO MATCH'} (${(verifyData.similarity * 100).toFixed(2)}%)`)
            
            // Only capture if face is verified
            if (isMatch) {
              const currentDescriptors = capturedDescriptorsRef.current
              const isDifferentCapture = currentDescriptors.length === 0 || 
                currentDescriptors.every(prev => {
                  let diff = 0
                  for (let i = 0; i < 512; i++) {
                    diff += Math.abs(descriptor[i] - prev[i])
                  }
                  const isDiff = diff > 0.5
                  if (!isDiff) {
                    console.log('⏭️ Skipping similar capture (diff:', diff.toFixed(2), ')')
                  }
                  return isDiff
                })
              
              if (isDifferentCapture && currentDescriptors.length < REQUIRED_CAPTURES) {
                console.log(`✅ Valid capture ${currentDescriptors.length + 1}/${REQUIRED_CAPTURES} (Similarity: ${(verifyData.similarity * 100).toFixed(2)}%)`)
                console.log(`   Confidence: ${pythonResult.confidence?.toFixed(3)}`)
                
                const updatedDescriptors = [...currentDescriptors, descriptor]
                capturedDescriptorsRef.current = updatedDescriptors
                setCapturedDescriptors(updatedDescriptors)
                
                if (updatedDescriptors.length >= REQUIRED_CAPTURES && !isVerifying) {
                  console.log('🎯 All captures verified! Completing authentication...')
                  await performFaceVerification(updatedDescriptors)
                }
              }
            } else {
              // Wrong face detected - reset captures and add cooldown
              if (capturedDescriptorsRef.current.length > 0) {
                console.log('🚨 Different face detected - resetting captures')
                setCapturedDescriptors([])
                capturedDescriptorsRef.current = []
              }
              
              // Set cooldown to prevent rapid API spam on wrong faces (1.5 seconds)
              verificationCooldownRef.current = true
              setVerificationMessage('Face not recognized. Please show your registered face.')
              setTimeout(() => {
                verificationCooldownRef.current = false
                setVerificationMessage('')
              }, 1500)
            }
          } else {
            console.log('⚠️ Python extraction failed:', pythonResult.error)
          }
        } else {
          setFaceDetected(false)
        }
      } catch (error) {
        console.error('Face detection error:', error)
      }
    }, 700) // Increased to 700ms to reduce API calls while staying responsive
  }

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
      alert('Models loading...')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      
      streamRef.current = stream
      requestAnimationFrame(() => {
        setShowCamera(true)
      })
    } catch (error) {
      console.error('Camera error:', error)
      alert('Unable to access camera. Please check permissions.')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setShowCamera(false)
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current)
    }
    setFaceDetected(false)
    setCapturedDescriptors([])
    capturedDescriptorsRef.current = [] // Reset ref
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center mb-4">
            <ShieldCheck className="w-8 h-8 text-emerald-600" />
          </div>
          <CardTitle>Verify Your Identity</CardTitle>
          <CardDescription>Live face verification required to access the class session</CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {!showCamera ? (
            <div className="text-center space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
                <p className="text-sm font-semibold text-amber-900 mb-2">🔒 Security Notice:</p>
                <ul className="text-xs text-amber-800 space-y-1 list-disc list-inside">
                  <li>System will capture 3 different frames</li>
                  <li>Move your head slightly during capture</li>
                  <li>Photos and static images will be rejected</li>
                  <li>All captures must match your registered face</li>
                </ul>
              </div>
              <Button onClick={startCamera} className="w-full gap-2" disabled={!modelsLoaded}>
                <Camera className="w-4 h-4" />
                {modelsLoaded ? 'Start Live Verification' : 'Loading Models...'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  className="w-full h-full object-cover transform scale-x-[-1]"
                />
                
                {!faceDetected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="text-center text-white">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                      <p className="text-sm">Position your face in frame</p>
                    </div>
                  </div>
                )}

                {verificationStatus === 'scanning' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="text-center text-white">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                      <p className="text-sm">Verifying...</p>
                    </div>
                  </div>
                )}

                {verificationStatus === 'success' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-green-500/40">
                    <div className="text-center text-white">
                      <Check className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-sm">{verificationMessage}</p>
                    </div>
                  </div>
                )}

                {verificationStatus === 'failed' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-500/40">
                    <div className="text-center text-white">
                      <X className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-sm">{verificationMessage}</p>
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
                  className="w-full"
                  disabled={isVerifying}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
