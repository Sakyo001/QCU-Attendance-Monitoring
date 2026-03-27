'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, UserPlus, Camera, RefreshCw, ShieldCheck, Loader2, ScanFace, CircleAlert, CircleCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/utils/supabase/client'
import { extractFaceNetFromVideo, checkFaceNetHealth, waitForModelReady } from '@/lib/facenet-python-api'

interface Section {
  id: string
  section_code: string
  semester: string
  academic_year: string
  max_students: number
}

interface FaceBox {
  x: number
  y: number
  width: number
  height: number
}

export default function AddFacultyPage() {
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [formErrors, setFormErrors] = useState<{ contactNumber?: string; employeeId?: string }>({})

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    employeeId: '',
    role: 'professor' as 'professor',
    contactNumber: '',
  })

  // Camera and face detection states
  const [showCamera, setShowCamera] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  const [boundingBox, setBoundingBox] = useState<FaceBox | null>(null)
  const [captureCountdown, setCaptureCountdown] = useState<number | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [serverHealthy, setServerHealthy] = useState(true)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectionInFlightRef = useRef(false)
  const smoothedBoxRef = useRef<FaceBox | null>(null)
  const savedFaceDescriptorRef = useRef<Float32Array | null>(null)
  const faceStableStartRef = useRef<number | null>(null)
  const consecutiveFaceDetectionsRef = useRef<number>(0)
  const consecutiveServerErrorsRef = useRef<number>(0)

  const toSquareBoundingBox = (box: FaceBox, videoWidth: number, videoHeight: number): FaceBox => {
    const pad = 0.18
    const side = Math.max(box.width, box.height) * (1 + pad)
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    let x = centerX - side / 2
    let y = centerY - side / 2
    let size = side

    if (x < 0) x = 0
    if (y < 0) y = 0
    if (x + size > videoWidth) x = Math.max(0, videoWidth - size)
    if (y + size > videoHeight) y = Math.max(0, videoHeight - size)

    size = Math.min(size, videoWidth, videoHeight)

    return {
      x,
      y,
      width: size,
      height: size,
    }
  }

  const smoothBoundingBox = (nextBox: FaceBox): FaceBox => {
    const previous = smoothedBoxRef.current
    if (!previous) {
      smoothedBoxRef.current = nextBox
      return nextBox
    }

    const alpha = 0.35
    const smoothed = {
      x: previous.x + (nextBox.x - previous.x) * alpha,
      y: previous.y + (nextBox.y - previous.y) * alpha,
      width: previous.width + (nextBox.width - previous.width) * alpha,
      height: previous.height + (nextBox.height - previous.height) * alpha,
    }
    smoothedBoxRef.current = smoothed
    return smoothed
  }

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      router.push('/admin/login')
    }
  }, [user, router])

  // Check Python FaceNet server health and warm up model
  useEffect(() => {
    const checkServer = async () => {
      const healthy = await checkFaceNetHealth()
      setServerHealthy(healthy)
      if (healthy) {
        await waitForModelReady()
        setModelsLoaded(true)  // server ready = models loaded
      }
    }
    checkServer()
  }, [])

  // Canvas drawing effect for bounding box
  useEffect(() => {
    if (!showCamera || !canvasRef.current || !videoRef.current) return

    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let prevCanvasWidth = 0
    let prevCanvasHeight = 0

    const drawFrame = () => {
      const vw = video.videoWidth
      const vh = video.videoHeight

      if (!vw || !vh) {
        animationId = requestAnimationFrame(drawFrame)
        return
      }

      if (vw !== prevCanvasWidth || vh !== prevCanvasHeight) {
        canvas.width = vw
        canvas.height = vh
        prevCanvasWidth = vw
        prevCanvasHeight = vh
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (boundingBox) {
        const { x, y, width, height } = boundingBox
        
        // Green for detected face
        const boxColor = '#10b981'
        
        // Draw glow effect
        ctx.shadowColor = boxColor
        ctx.shadowBlur = 20
        ctx.strokeStyle = boxColor
        ctx.lineWidth = 4
        ctx.strokeRect(x, y, width, height)
        ctx.shadowBlur = 0
        
        // Draw corner markers
        const cornerLength = 35
        ctx.lineWidth = 5
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
        
        // Draw status label
        const labelText = 'Face Detected - Ready to Capture'
        ctx.font = 'bold 16px system-ui, sans-serif'
        const textWidth = ctx.measureText(labelText).width
        const padding = 12
        const labelHeight = 32
        
        ctx.fillStyle = 'rgba(16, 185, 129, 0.95)'
        ctx.beginPath()
        const labelX = x
        const labelY = y - labelHeight - 8
        const labelWidth = textWidth + padding * 2
        ctx.roundRect(labelX, labelY, labelWidth, labelHeight, 6)
        ctx.fill()
        
        // Flip text to be readable
        ctx.save()
        ctx.scale(-1, 1)
        ctx.fillStyle = 'white'
        ctx.fillText(labelText, -(labelX + padding + textWidth), labelY + 22)
        ctx.restore()
      }

      animationId = requestAnimationFrame(drawFrame)
    }

    drawFrame()

    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [showCamera, boundingBox])

  // Handle stream attachment when camera is shown
  useEffect(() => {
    if (!showCamera || !streamRef.current || !videoRef.current) return

    videoRef.current.srcObject = streamRef.current
    
    const playPromise = videoRef.current.play()
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.error('Autoplay failed, retrying...', err)
        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.play().catch(e => console.error('Retry failed:', e))
          }
        }, 100)
      })
    }

    // Start face detection
    startFaceDetection()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [showCamera])

  const startFaceDetection = () => {
    if (!videoRef.current || !modelsLoaded) return

    const CAPTURE_DELAY = 900

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isCapturing) return
      if (videoRef.current.readyState !== 4 || videoRef.current.videoWidth === 0) return
      if (detectionInFlightRef.current) return

      try {
        detectionInFlightRef.current = true
        const result = await extractFaceNetFromVideo(videoRef.current, {
          quality: 0.82,
          maxDimension: 720,
        })

        // Auto-stop if server is consistently unreachable (5 consecutive errors ≈ 2s)
        if (result.error) {
          consecutiveServerErrorsRef.current += 1
          if (consecutiveServerErrorsRef.current >= 5) {
            setServerHealthy(false)
            stopCamera()
            setError('Face recognition server is unreachable. Please start the Python server and try again.')
          }
          return
        }
        consecutiveServerErrorsRef.current = 0

        if (result.detected) {
          // Spoof check: reset capture timer and treat as "no face" so the
          // countdown never completes for a phone screen / printed photo.
          if (result.spoofDetected || !result.embedding) {
            setFaceDetected(false)
            setBoundingBox(null)
            consecutiveFaceDetectionsRef.current = 0
            faceStableStartRef.current = null
            setCaptureCountdown(null)
            return
          }

          setFaceDetected(true)
          const descriptor = new Float32Array(result.embedding)
          setFaceDescriptor(descriptor)
          savedFaceDescriptorRef.current = descriptor

          // Use bounding box from server response
          if (result.box) {
            const squareBox = toSquareBoundingBox(
              result.box,
              videoRef.current.videoWidth,
              videoRef.current.videoHeight
            )
            setBoundingBox(smoothBoundingBox(squareBox))
          }

          consecutiveFaceDetectionsRef.current += 1

          if (!faceStableStartRef.current) faceStableStartRef.current = Date.now()
          const elapsed = Date.now() - faceStableStartRef.current
          setCaptureCountdown(Math.max(0, Math.ceil((CAPTURE_DELAY - elapsed) / 1000)))
          if (elapsed >= CAPTURE_DELAY && !isCapturing) {
            capturePhoto()
          }
        } else {
          setFaceDetected(false)
          setBoundingBox(null)
          smoothedBoxRef.current = null
          consecutiveFaceDetectionsRef.current = 0
          faceStableStartRef.current = null
          setCaptureCountdown(null)
        }
      } catch (err) {
        console.warn('Face detection error:', err)
      } finally {
        detectionInFlightRef.current = false
      }
    }, 180)  // Fast polling with in-flight guard keeps UI responsive without overlap.
  }

  const startCamera = async () => {
    if (!modelsLoaded) {
      setError('Face detection models are still loading...')
      return
    }

    if (!serverHealthy) {
      setError('Face recognition server is not available. Please start the Python server.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      
      streamRef.current = stream
      setError('')
      consecutiveServerErrorsRef.current = 0
      
      requestAnimationFrame(() => {
        setShowCamera(true)
      })
    } catch (error: any) {
      setError(`Camera error: ${error.message}`)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)

    setShowCamera(false)
    setIsCapturing(false)
    setFaceDetected(false)
    setBoundingBox(null)
    setCaptureCountdown(null)
    smoothedBoxRef.current = null
    detectionInFlightRef.current = false

    faceStableStartRef.current = null
    consecutiveFaceDetectionsRef.current = 0
  }

  const capturePhoto = () => {
    const descriptorToCheck = faceDescriptor || savedFaceDescriptorRef.current
    
    if (!descriptorToCheck) {
      setError('Face not detected! Please position your face clearly.')
      return
    }
    
    if (videoRef.current && !isCapturing) {
      setIsCapturing(true)
      
      const savedDescriptor = faceDescriptor
      if (savedDescriptor) {
        savedFaceDescriptorRef.current = savedDescriptor
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
        
        stopCamera()
        
        if (savedDescriptor) {
          setFaceDescriptor(savedDescriptor)
        }
      }
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target

    if (name === 'firstName' || name === 'lastName') {
      // Block numeric characters from name fields
      const filtered = value.replace(/[0-9]/g, '')
      setFormData(prev => ({ ...prev, [name]: filtered }))
      return
    }

    if (name === 'contactNumber') {
      // Only allow digits, max 11 characters
      const filtered = value.replace(/[^0-9]/g, '').slice(0, 11)
      setFormData(prev => ({ ...prev, [name]: filtered }))
      if (formErrors.contactNumber) setFormErrors(prev => ({ ...prev, contactNumber: undefined }))
      return
    }

    if (name === 'employeeId') {
      const filtered = value.replace(/\s/g, '')
      setFormData(prev => ({ ...prev, [name]: filtered }))
      if (formErrors.employeeId) setFormErrors(prev => ({ ...prev, employeeId: undefined }))
      return
    }

    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmedEmployeeId = formData.employeeId.trim()
    const trimmedFirstName = formData.firstName.trim()
    const trimmedLastName = formData.lastName.trim()

    if (!capturedImage || !savedFaceDescriptorRef.current) {
      setError('Please capture a face photo for the faculty member')
      return
    }

    // Validate contact number if provided
    const errors: { contactNumber?: string; employeeId?: string } = {}

    if (!trimmedFirstName || !trimmedLastName) {
      setError('First name and last name are required')
      return
    }

    if (!trimmedEmployeeId) {
      errors.employeeId = 'Employee ID is required'
    } else if (!/^[A-Za-z0-9_-]{3,30}$/.test(trimmedEmployeeId)) {
      errors.employeeId = 'Employee ID must be 3-30 characters and use only letters, numbers, underscore, or hyphen'
    }

    if (formData.contactNumber && formData.contactNumber.length !== 11) {
      errors.contactNumber = 'Contact number must be exactly 11 digits'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setFormErrors({})

    setIsSubmitting(true)

    try {
      const descriptorArray = Array.from(savedFaceDescriptorRef.current)

      let response: Response
      try {
        response = await fetch('/api/admin/faculty/add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            firstName: trimmedFirstName,
            lastName: trimmedLastName,
            email: formData.email.trim(),
            employeeId: trimmedEmployeeId,
            role: formData.role,
            contactNumber: formData.contactNumber,
            faceData: capturedImage,
            faceDescriptor: descriptorArray
          }),
        })
      } catch {
        setError('Unable to connect to the server. Please check your network and try again.')
        setIsSubmitting(false)
        return
      }

      let data: any = {}
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        data = await response.json()
      } else {
        const fallbackText = await response.text()
        data = { error: fallbackText || 'Unexpected server response.' }
      }

      if (!response.ok) {
        const apiMessage = data?.error || 'Failed to create faculty member'
        const duplicateEmployeeId =
          response.status === 409 ||
          data?.code === 'EMPLOYEE_ID_EXISTS' ||
          /employee.?id|duplicate key|already in use/i.test(apiMessage)

        if (duplicateEmployeeId) {
          setFormErrors(prev => ({
            ...prev,
            employeeId: 'This Employee ID is already registered. Please enter a different ID.'
          }))
          setError('')
        } else {
          setError(apiMessage)
        }

        setIsSubmitting(false)
        return
      }

      console.log('Faculty created successfully:', data.userId)
      router.push('/admin/faculty')
    } catch (err: any) {
      console.error('Error creating faculty:', err)
      setError(err.message || 'Failed to create faculty member')
      setIsSubmitting(false)
    }
  }

  if (!user || user.role !== 'admin') {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/admin/faculty')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Add New Faculty</h1>
              <p className="text-sm text-gray-600 mt-1">Create a new professor or adviser account with facial recognition</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* Face Registration Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Camera className="w-5 h-5 text-violet-600" />
              Face Registration *
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Capture a clear face photo for facial recognition login. The system will automatically detect and capture when ready.
            </p>

            {!showCamera && !capturedImage && (
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors">
                <ScanFace className="h-12 w-12 text-violet-400 mb-4" />
                <p className="text-gray-600 mb-6 text-center max-w-sm">
                  Position the faculty member in front of the camera. The system will detect and capture automatically.
                </p>
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={!modelsLoaded}
                  className="flex items-center gap-2 px-6 py-3 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-400 transition-colors"
                >
                  <Camera className="w-5 h-5" />
                  {modelsLoaded ? 'Start Camera' : 'Loading Models...'}
                </button>
                {!serverHealthy && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm mt-3">
                    <CircleAlert className="w-4 h-4" />
                    Face recognition server unavailable
                  </div>
                )}
              </div>
            )}

            {showCamera && (
              <div className="flex flex-col items-center gap-3">
                {/* Square camera viewport */}
                <div className="relative w-full max-w-md mx-auto aspect-square rounded-2xl overflow-hidden bg-black shadow-2xl ring-2 ring-violet-500/30">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]"
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none transform scale-x-[-1]"
                  />

                  {/* Top status bar */}
                  <div className="absolute top-3 inset-x-3 flex justify-center pointer-events-none">
                    {faceDetected ? (
                      <div className="flex items-center gap-2 bg-emerald-600/90 backdrop-blur-md text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        Face Detected
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md text-white text-sm px-4 py-2 rounded-full shadow-lg">
                        <ScanFace className="w-4 h-4 opacity-70" />
                        Position face in frame
                      </div>
                    )}
                  </div>

                  {/* No face badge */}
                  {!faceDetected && (
                    <div className="absolute top-14 inset-x-0 flex justify-center pointer-events-none">
                      <div className="flex items-center gap-1.5 bg-red-600/90 backdrop-blur-md text-white text-xs font-medium px-3 py-1.5 rounded-full">
                        <CircleAlert className="w-3.5 h-3.5" />
                        No face detected
                      </div>
                    </div>
                  )}

                  {/* Countdown badge */}
                  {faceDetected && captureCountdown !== null && captureCountdown > 0 && (
                    <div className="absolute bottom-16 inset-x-0 flex justify-center pointer-events-none">
                      <div className="flex items-center gap-2 bg-emerald-600/90 backdrop-blur-md text-white text-sm font-bold px-4 py-2 rounded-full animate-pulse">
                        <Camera className="w-4 h-4" />
                        Capturing in {captureCountdown}s
                      </div>
                    </div>
                  )}

                  {/* Bottom action buttons */}
                  <div className="absolute bottom-3 inset-x-3 flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="px-5 py-2.5 bg-red-600/90 backdrop-blur-md text-white text-sm font-medium rounded-xl hover:bg-red-600 transition-colors shadow-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={capturePhoto}
                      disabled={!faceDetected}
                      className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600/90 backdrop-blur-md text-white text-sm font-medium rounded-xl hover:bg-emerald-600 disabled:bg-gray-600/70 disabled:cursor-not-allowed transition-colors shadow-lg"
                    >
                      <Camera className="w-4 h-4" />
                      Capture
                    </button>
                  </div>
                </div>
              </div>
            )}

            {capturedImage && !showCamera && (
              <div className="flex flex-col items-center gap-3">
                <div className="relative w-full max-w-md mx-auto aspect-square rounded-2xl overflow-hidden border-2 border-emerald-500 bg-gray-100 shadow-lg">
                  <img src={capturedImage} alt="Captured face" className="w-full h-full object-cover" />
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-md">
                    <CircleCheck className="w-3.5 h-3.5" />
                    Face Captured
                  </div>
                  <div className="absolute bottom-3 right-3">
                    <button
                      type="button"
                      onClick={() => {
                        setCapturedImage(null)
                        savedFaceDescriptorRef.current = null
                        startCamera()
                      }}
                      className="flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur-md text-gray-700 rounded-xl hover:bg-white transition-colors text-sm font-medium shadow-md"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Retake
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Personal Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name *
                </label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address <span className="text-gray-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="For notifications only"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label htmlFor="contactNumber" className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Number <span className="text-gray-400 font-normal">(11 digits)</span>
                </label>
                <input
                  type="text"
                  id="contactNumber"
                  name="contactNumber"
                  value={formData.contactNumber}
                  onChange={handleInputChange}
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="09XXXXXXXXX"
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                    formErrors.contactNumber ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                />
                {formErrors.contactNumber && (
                  <p className="text-red-500 text-xs mt-1">{formErrors.contactNumber}</p>
                )}
              </div>


            </div>
          </div>

          {/* Employment Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Employment Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="employeeId" className="block text-sm font-medium text-gray-700 mb-1">
                  Employee ID *
                </label>
                <input
                  type="text"
                  id="employeeId"
                  name="employeeId"
                  value={formData.employeeId}
                  onChange={handleInputChange}
                  required
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                    formErrors.employeeId ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                />
                {formErrors.employeeId && (
                  <p className="text-red-500 text-xs mt-1">{formErrors.employeeId}</p>
                )}
              </div>

              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
                  Role *
                </label>
                <select
                  id="role"
                  name="role"
                  value={formData.role}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="professor">Professor</option>
                  <option value="adviser">Adviser</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label htmlFor="departmentId" className="block text-sm font-medium text-gray-700 mb-1">
                  Department
                </label>
                <input
                  type="text"
                  id="departmentId"
                  value="IT Department"
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push('/admin/faculty')}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !capturedImage}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:bg-violet-400 transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Create Faculty
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
