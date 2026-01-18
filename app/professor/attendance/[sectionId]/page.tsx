'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, Loader2, Camera, RefreshCw, Check, X, ShieldCheck, Clock, Users, Plus } from 'lucide-react'
import * as faceapi from 'face-api.js'

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
  const scheduleId = searchParams.get('schedule')

  const [checkingRegistration, setCheckingRegistration] = useState(true)
  const [isRegistered, setIsRegistered] = useState(false)
  const [attendanceSession, setAttendanceSession] = useState<AttendanceSession | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [showStudentRegModal, setShowStudentRegModal] = useState(false)
  const [showFaceRecognitionModal, setShowFaceRecognitionModal] = useState(false)
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([])

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'professor' && user.role !== 'adviser'))) {
      router.push('/professor/login')
      return
    }

    if (!loading && user) {
      checkFaceRegistration()
      fetchAttendanceSession()
    }
  }, [user, loading, router])

  const checkFaceRegistration = async () => {
    try {
      setCheckingRegistration(true)
      
      if (!user?.id) {
        console.warn('No user ID available for face registration check')
        setCheckingRegistration(false)
        return
      }

      console.log('Checking face registration for professor:', user.id)
      const response = await fetch(`/api/professor/face-registration/check?professorId=${user.id}`)
      const data = await response.json()

      console.log('Face registration check response:', data)

      if (data.success) {
        setIsRegistered(data.isRegistered)
      } else {
        console.error('Check failed:', data.error)
        setIsRegistered(false)
      }
    } catch (error) {
      console.error('Error checking face registration:', error)
      setIsRegistered(false)
    } finally {
      setCheckingRegistration(false)
    }
  }

  const fetchAttendanceSession = async () => {
    try {
      setLoadingSession(true)
      const response = await fetch(`/api/professor/attendance/session?classSessionId=${scheduleId}`)
      const data = await response.json()

      if (data.success) {
        setAttendanceSession(data.session)
        // Fetch attendance records for this session
        await fetchAttendanceRecords(data.session.id)
      }
    } catch (error) {
      console.error('Error fetching attendance session:', error)
    } finally {
      setLoadingSession(false)
    }
  }

  const fetchAttendanceRecords = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/professor/attendance/records?sessionId=${sessionId}`)
      const data = await response.json()
      
      if (data.success) {
        setAttendanceRecords(data.records || [])
      }
    } catch (error) {
      console.error('Error fetching attendance records:', error)
    }
  }

  const handleOpenShift = async () => {
    try {
      const response = await fetch('/api/professor/attendance/session/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classSessionId: scheduleId,
          professorId: user?.id
        })
      })

      const data = await response.json()

      if (data.success) {
        setAttendanceSession(data.session)
        await logShiftEvent(data.session.id, 'shift_open')
        // Show facial recognition for attendance
        setShowFaceRecognitionModal(true)
      } else {
        alert(data.error || 'Failed to open shift')
      }
    } catch (error) {
      console.error('Error opening shift:', error)
      alert('Failed to open shift')
    }
  }

  const handleCloseShift = async () => {
    if (!attendanceSession) return

    try {
      const response = await fetch('/api/professor/attendance/session/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: attendanceSession.id
        })
      })

      const data = await response.json()

      if (data.success) {
        setAttendanceSession(data.session)
        await logShiftEvent(attendanceSession.id, 'shift_close')
      } else {
        alert(data.error || 'Failed to close shift')
      }
    } catch (error) {
      console.error('Error closing shift:', error)
      alert('Failed to close shift')
    }
  }

  const logShiftEvent = async (sessionId: string, eventType: 'shift_open' | 'shift_close') => {
    try {
      await fetch('/api/professor/attendance/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          eventType,
          professorId: user?.id
        })
      })
    } catch (error) {
      console.error('Error logging shift event:', error)
    }
  }

  const handleRegistrationComplete = () => {
    setIsRegistered(true)
    checkFaceRegistration()
  }

  if (loading || checkingRegistration || loadingSession) {
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

  const isShiftActive = attendanceSession?.is_active || false

  return (
    <div className="min-h-screen bg-neutral-50/50">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 bg-background border-b px-6">
        <Button variant="ghost" size="icon" onClick={() => router.push('/professor')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Class Session</h1>
          <p className="text-xs text-muted-foreground hidden sm:block">Manage attendance and session status</p>
        </div>
        <div className="flex items-center gap-2">
          {!isShiftActive ? (
            <Button onClick={handleOpenShift} className="gap-2 font-medium">
              Open Shift
            </Button>
          ) : (
            <Button variant="destructive" onClick={handleCloseShift} className="gap-2 font-medium">
              Close Shift
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowStudentRegModal(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Register Student
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-6xl py-8 space-y-8 px-6">
        {/* Status Indicators */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Session Status</CardTitle>
              {isShiftActive ? (
                 <Badge className="bg-emerald-600 hover:bg-emerald-700">Active</Badge>
              ) : (
                 <Badge variant="secondary">Inactive</Badge>
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isShiftActive ? 'Live' : 'Closed'}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isShiftActive 
                  ? 'Students can mark attendance.' 
                  : 'Start session to enable attendance.'}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
               <CardTitle className="text-sm font-medium">Start Time</CardTitle>
               <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {attendanceSession?.shift_opened_at 
                  ? new Date(attendanceSession.shift_opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                  : '--:--'}
              </div>
               <p className="text-xs text-muted-foreground mt-1">
                Session started at
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
               <CardTitle className="text-sm font-medium">Attendees</CardTitle>
               <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
               <p className="text-xs text-muted-foreground mt-1">
                Students present
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Attendance List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
             <h2 className="text-lg font-semibold tracking-tight">Attendance Log</h2>
             {isShiftActive && (
               <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium animate-pulse">
                 <div className="w-2 h-2 rounded-full bg-emerald-600" />
                 Live Updates
               </div>
             )}
          </div>
          
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
             <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-20">Photo</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Student ID</TableHead>
                    <TableHead>Time In</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                   {attendanceRecords.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={5} className="h-32 text-center">
                          <div className="flex flex-col items-center justify-center text-muted-foreground">
                            <Users className="h-8 w-8 mb-2 opacity-20" />
                            <p>No attendance records yet.</p>
                          </div>
                       </TableCell>
                     </TableRow>
                   ) : (
                     attendanceRecords.map((record: any) => (
                       <TableRow key={record.id}>
                         <TableCell>
                           <Avatar className="h-10 w-10">
                             <AvatarImage src={record.profile_picture_url} />
                             <AvatarFallback>{record.first_name?.[0]}{record.last_name?.[0]}</AvatarFallback>
                           </Avatar>
                         </TableCell>
                         <TableCell className="font-medium">{record.first_name} {record.last_name}</TableCell>
                         <TableCell>{record.student_id}</TableCell>
                         <TableCell>
                           {record.time_in ? new Date(record.time_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                         </TableCell>
                         <TableCell className="text-right">
                           <Badge className={record.status === 'present' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-500 hover:bg-gray-600'}>
                             {record.status}
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
          onClose={() => setShowStudentRegModal(false)}
        />
      )}

      {/* Attendance Recognition Modal */}
      {showFaceRecognitionModal && (
        <AttendanceRecognitionModal
          sessionId={attendanceSession?.id}
          isOpen={showFaceRecognitionModal}
          onClose={() => setShowFaceRecognitionModal(false)}
          onStudentMarked={() => fetchAttendanceRecords(attendanceSession?.id)}
        />
      )}
    </div>
  )
}

// --- Student Registration Modal ---

interface StudentRegistrationModalProps {
  onClose: () => void
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

function StudentRegistrationModal({ onClose }: StudentRegistrationModalProps) {
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
  const [currentStep, setCurrentStep] = useState<StudentLivenessStep>('center')
  const [livenessProgress, setLivenessProgress] = useState<StudentLivenessProgress>({
    center: false,
    left: false,
    right: false,
    up: false
  })
  const [livenessComplete, setLivenessComplete] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [isInValidPosition, setIsInValidPosition] = useState(false)
  const [credentials, setCredentials] = useState<StudentCredentials | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const holdCounterRef = useRef(0)
  const isInValidPositionRef = useRef(false)
  const currentStepRef = useRef<StudentLivenessStep>('center')

  const HOLD_FRAMES_REQUIRED = 3

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
    if (showCamera && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current
      startFaceDetection()
    }
    return () => {
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [showCamera, modelsLoaded])

  useEffect(() => {
    currentStepRef.current = currentStep
    holdCounterRef.current = 0
    setHoldProgress(0)
    setIsInValidPosition(false)
    isInValidPositionRef.current = false
  }, [currentStep])

  const calculateHeadPose = (landmarks: faceapi.FaceLandmarks68) => {
    const points = landmarks.positions
    const noseTip = points[30]
    const leftEye = points[36]
    const rightEye = points[45]
    const leftMouth = points[48]
    const rightMouth = points[54]
    const chin = points[8]

    const eyeDistance = Math.abs(rightEye.x - leftEye.x)
    const leftDistance = Math.abs(noseTip.x - leftEye.x)
    const rightDistance = Math.abs(noseTip.x - rightEye.x)
    const yaw = -((leftDistance - rightDistance) / eyeDistance) * 100

    const eyeCenterY = (leftEye.y + rightEye.y) / 2
    const mouthCenterY = (leftMouth.y + rightMouth.y) / 2
    const faceHeight = Math.abs(chin.y - eyeCenterY)
    const noseMouthDistance = Math.abs(noseTip.y - mouthCenterY)
    const pitch = ((noseMouthDistance / faceHeight) - 0.5) * 100

    return { yaw, pitch }
  }

  const checkLivenessStep = (yaw: number, pitch: number) => {
    const YAW_ENTER = 12
    const PITCH_ENTER = 5
    const CENTER_ENTER = 25
    const CENTER_EXIT = 30

    let positionCorrect = false

    switch (currentStepRef.current) {
      case 'center':
        if (isInValidPositionRef.current) {
          positionCorrect = Math.abs(yaw) < CENTER_EXIT && Math.abs(pitch) < CENTER_EXIT
        } else {
          positionCorrect = Math.abs(yaw) < CENTER_ENTER && Math.abs(pitch) < CENTER_ENTER
        }
        break
      case 'left':
        positionCorrect = isInValidPositionRef.current ? (yaw < -YAW_ENTER + 3) : (yaw < -YAW_ENTER)
        break
      case 'right':
        positionCorrect = isInValidPositionRef.current ? (yaw > YAW_ENTER - 3) : (yaw > YAW_ENTER)
        break
      case 'up':
        positionCorrect = isInValidPositionRef.current ? (pitch > PITCH_ENTER - 3) : (pitch > PITCH_ENTER)
        break
    }

    isInValidPositionRef.current = positionCorrect
    setIsInValidPosition(positionCorrect)

    if (positionCorrect) {
      holdCounterRef.current++
      const progress = (holdCounterRef.current / HOLD_FRAMES_REQUIRED) * 100
      setHoldProgress(() => progress)

      if (holdCounterRef.current >= HOLD_FRAMES_REQUIRED) {
        switch (currentStepRef.current) {
          case 'center':
            setLivenessProgress(prev => ({ ...prev, center: true }))
            setCurrentStep('left')
            break
          case 'left':
            setLivenessProgress(prev => ({ ...prev, left: true }))
            setCurrentStep('right')
            break
          case 'right':
            setLivenessProgress(prev => ({ ...prev, right: true }))
            setCurrentStep('up')
            break
          case 'up':
            setLivenessProgress(prev => ({ ...prev, up: true }))
            setCurrentStep('complete')
            setLivenessComplete(true)
            break
        }
      }
    } else {
      if (holdCounterRef.current > 0) {
        holdCounterRef.current = Math.max(0, holdCounterRef.current - 1)
        const progress = (holdCounterRef.current / HOLD_FRAMES_REQUIRED) * 100
        setHoldProgress(() => progress)
      }
    }
  }

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
            const { yaw, pitch } = calculateHeadPose(detection.landmarks)
            checkLivenessStep(yaw, pitch)
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
      alert('Models loading...')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      streamRef.current = stream
      setShowCamera(true)
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
    setCurrentStep('center')
    setLivenessComplete(false)
    setLivenessProgress({ center: false, left: false, right: false, up: false })
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
      const response = await fetch('/api/student/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          middleInitial: formData.middleInitial,
          studentId: formData.studentId,
          email: formData.email,
          faceData: capturedImage,
          faceDescriptor: faceDescriptor ? Array.from(faceDescriptor) : null
        })
      })

      const data = await response.json()
      if (data.success && data.credentials) {
        setCredentials(data.credentials)
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
                  <input
                    type="text"
                    value={formData.studentId}
                    onChange={(e) => setFormData(prev => ({ ...prev, studentId: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="e.g., 2024-001"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Gmail/Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="e.g., student@gmail.com"
                  required
                />
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
                      isInValidPosition ? 'border-primary' : 'border-white/30'
                    }`} />
                  </div>

                  <div className="absolute top-4 inset-x-0 flex flex-col items-center pointer-events-none">
                    {!livenessComplete ? (
                      <div className="bg-black/80 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md">
                        {currentStep === 'center' && 'Look Straight'}
                        {currentStep === 'left' && 'Turn Head Left'}
                        {currentStep === 'right' && 'Turn Head Right'}
                        {currentStep === 'up' && 'Chin Up'}
                      </div>
                    ) : (
                      <div className="bg-emerald-600/90 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2">
                        <Check className="w-4 h-4" /> Verified
                      </div>
                    )}

                    {isInValidPosition && !livenessComplete && (
                      <div className="mt-2 w-32 h-1 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all duration-100" style={{ width: `${holdProgress}%` }} />
                      </div>
                    )}
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
            <Button type="submit" disabled={isSubmitting || !capturedImage}>
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
  sessionId: string | undefined
  isOpen: boolean
  onClose: () => void
  onStudentMarked: () => void
}

function AttendanceRecognitionModal({ sessionId, isOpen, onClose, onStudentMarked }: AttendanceRecognitionModalProps) {
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

  useEffect(() => {
    if (isOpen && showCamera && modelsLoaded) {
      startCamera()
    }
    return () => {
      stopCamera()
    }
  }, [isOpen, showCamera, modelsLoaded])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        startFaceDetection()
      }
    } catch (error: any) {
      setRecognitionError(`Camera error: ${error.message}`)
    }
  }

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
        console.error('Face detection error:', error)
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

      // Mark attendance
      const markResponse = await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          studentId: student.id
        })
      })

      const markData = await markResponse.json()

      if (markData.success) {
        setRecognitionError(null)
        // Wait 2 seconds then refresh records
        setTimeout(() => {
          onStudentMarked()
          setRecognizingStudent(null)
          setIsProcessing(false)
        }, 2000)
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
              <Button onClick={() => setShowCamera(true)} disabled={!modelsLoaded} className="gap-2">
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
                <Button variant="outline" onClick={() => {
                  setShowCamera(false)
                  setRecognizingStudent(null)
                  setRecognitionError(null)
                  setIsProcessing(false)
                }}>
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
  const [currentStep, setCurrentStep] = useState<LivenessStep>('center')
  const [livenessProgress, setLivenessProgress] = useState<LivenessProgress>({
    center: false,
    left: false,
    right: false,
    up: false,
    rotate: false
  })
  const [livenessComplete, setLivenessComplete] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [isInValidPosition, setIsInValidPosition] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const holdCounterRef = useRef(0)
  const isInValidPositionRef = useRef(false)
  const currentStepRef = useRef<LivenessStep>('center')
  
  const HOLD_FRAMES_REQUIRED = 3

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
    if (showCamera && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current
      startFaceDetection()
    }
    return () => {
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [showCamera, modelsLoaded])

  useEffect(() => {
    currentStepRef.current = currentStep
    holdCounterRef.current = 0
    setHoldProgress(0)
    setIsInValidPosition(false)
    isInValidPositionRef.current = false
  }, [currentStep])

  const calculateHeadPose = (landmarks: faceapi.FaceLandmarks68) => {
    const points = landmarks.positions
    const noseTip = points[30]
    const leftEye = points[36]
    const rightEye = points[45]
    const leftMouth = points[48]
    const rightMouth = points[54]
    const chin = points[8]

    const eyeDistance = Math.abs(rightEye.x - leftEye.x)
    const leftDistance = Math.abs(noseTip.x - leftEye.x)
    const rightDistance = Math.abs(noseTip.x - rightEye.x)
    const yaw = -((leftDistance - rightDistance) / eyeDistance) * 100

    const eyeCenterY = (leftEye.y + rightEye.y) / 2
    const mouthCenterY = (leftMouth.y + rightMouth.y) / 2
    const faceHeight = Math.abs(chin.y - eyeCenterY)
    const noseMouthDistance = Math.abs(noseTip.y - mouthCenterY)
    const pitch = ((noseMouthDistance / faceHeight) - 0.5) * 100
    const roll = ((rightEye.y - leftEye.y) / eyeDistance) * 100

    return { yaw, pitch, roll }
  }

  const checkLivenessStep = (yaw: number, pitch: number, roll: number) => {
    const YAW_ENTER = 12
    const PITCH_ENTER = 5
    const CENTER_ENTER = 25
    const CENTER_EXIT = 30
    
    let positionCorrect = false

    switch (currentStepRef.current) {
      case 'center':
        if (isInValidPositionRef.current) {
          positionCorrect = Math.abs(yaw) < CENTER_EXIT && Math.abs(pitch) < CENTER_EXIT
        } else {
          positionCorrect = Math.abs(yaw) < CENTER_ENTER && Math.abs(pitch) < CENTER_ENTER
        }
        break
      case 'left':
        positionCorrect = isInValidPositionRef.current ? (yaw < -YAW_ENTER + 3) : (yaw < -YAW_ENTER)
        break
      case 'right':
        positionCorrect = isInValidPositionRef.current ? (yaw > YAW_ENTER - 3) : (yaw > YAW_ENTER)
        break
      case 'up':
        positionCorrect = isInValidPositionRef.current ? (pitch > PITCH_ENTER - 3) : (pitch > PITCH_ENTER)
        break
    }

    isInValidPositionRef.current = positionCorrect
    setIsInValidPosition(positionCorrect)

    if (positionCorrect) {
      holdCounterRef.current++
      const progress = (holdCounterRef.current / HOLD_FRAMES_REQUIRED) * 100
      setHoldProgress(() => progress)

      if (holdCounterRef.current >= HOLD_FRAMES_REQUIRED) {
        switch (currentStepRef.current) {
          case 'center':
            setLivenessProgress(prev => ({ ...prev, center: true }))
            setCurrentStep('left')
            break
          case 'left':
            setLivenessProgress(prev => ({ ...prev, left: true }))
            setCurrentStep('right')
            break
          case 'right':
            setLivenessProgress(prev => ({ ...prev, right: true }))
            setCurrentStep('up')
            break
          case 'up':
            setLivenessProgress(prev => ({ ...prev, up: true }))
            setCurrentStep('complete')
            setLivenessComplete(true)
            break
        }
      }
    } else {
      if (holdCounterRef.current > 0) {
        holdCounterRef.current = Math.max(0, holdCounterRef.current - 1)
        const progress = (holdCounterRef.current / HOLD_FRAMES_REQUIRED) * 100
        setHoldProgress(() => progress)
      }
    }
  }

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
            const { yaw, pitch, roll } = calculateHeadPose(detection.landmarks)
            checkLivenessStep(yaw, pitch, roll)
          }
          
          if (!livenessCheck || livenessComplete) {
            if (!captureTimeoutRef.current) {
               // Auto-capture removed for UX control - user should click capture
            }
          }
        } else {
          setFaceDetected(false)
          setFaceDescriptor(null)
          if (captureTimeoutRef.current) {
            clearTimeout(captureTimeoutRef.current)
            captureTimeoutRef.current = null
          }
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
      streamRef.current = stream
      setShowCamera(true)
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
    setLivenessCheck(false)
    setCurrentStep('center')
    setLivenessComplete(false)
    setLivenessProgress({ center: false, left: false, right: false, up: false, rotate: false })
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
                           isInValidPosition ? 'border-primary' : 'border-white/30'
                        }`} />
                      </div>

                      {/* Instructions */}
                      <div className="absolute top-4 inset-x-0 flex flex-col items-center pointer-events-none">
                         {!livenessComplete ? (
                           <div className="bg-black/80 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md">
                             {currentStep === 'center' && 'Look Straight'}
                             {currentStep === 'left' && 'Turn Head Left'}
                             {currentStep === 'right' && 'Turn Head Right'}
                             {currentStep === 'up' && 'Chin Up'}
                           </div>
                         ) : (
                           <div className="bg-emerald-600/90 text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2">
                             <Check className="w-4 h-4" /> Verified
                           </div>
                         )}
                         
                         {isInValidPosition && !livenessComplete && (
                           <div className="mt-2 w-32 h-1 bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full bg-primary transition-all duration-100" style={{ width: `${holdProgress}%` }} />
                           </div>
                         )}
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
