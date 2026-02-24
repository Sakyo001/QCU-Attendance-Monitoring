'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { Camera, ArrowLeft } from 'lucide-react'
import { extractFaceNetFromVideo, checkFaceNetHealth, waitForModelReady } from '@/lib/facenet-python-api'

export default function StudentFaceRegistrationPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [isRegistered, setIsRegistered] = useState(false)
  const [checkingRegistration, setCheckingRegistration] = useState(true)

  useEffect(() => {
    if (!loading && (!user || user.role !== 'student')) {
      router.push('/student/login')
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
      }
    } catch (error) {
      console.error('Error checking face registration:', error)
    } finally {
      setCheckingRegistration(false)
    }
  }

  const handleRegistrationComplete = () => {
    setIsRegistered(true)
    // Redirect to student home or attendance page
    setTimeout(() => {
      router.push('/student')
    }, 1500)
  }

  if (loading || checkingRegistration) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  // If already registered, redirect
  if (isRegistered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Redirecting...</p>
        </div>
      </div>
    )
  }

  return (
    <FaceRegistrationModal
      studentId={user?.id || ''}
      studentName={`${user?.firstName} ${user?.lastName}`}
      onComplete={handleRegistrationComplete}
    />
  )
}

interface FaceRegistrationModalProps {
  studentId: string
  studentName: string
  onComplete: () => void
}

function FaceRegistrationModal({ studentId, studentName, onComplete }: FaceRegistrationModalProps) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    middleInitial: '',
    studentNumber: ''
  })
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  const [recognizedName, setRecognizedName] = useState<string>('')
  const [recognitionConfidence, setRecognitionConfidence] = useState<number>(0)
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [autoCapture, setAutoCapture] = useState(true)
  const [boundingBoxMode, setBoundingBoxMode] = useState(true)
  const [captureCountdown, setCaptureCountdown] = useState<number>(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const autoCaptureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const faceStableStartRef = useRef<number | null>(null)
  const consecutiveFaceDetectionsRef = useRef<number>(0)
  const savedFaceDescriptorRef = useRef<Float32Array | null>(null) // Permanent storage for captured descriptor

  // Check Python FaceNet server health
  useEffect(() => {
    const checkServer = async () => {
      const healthy = await checkFaceNetHealth()
      if (!healthy) {
        console.warn('⚠️ Python FaceNet server not responding')
        alert('Python FaceNet server is not running. Please start: python facenet-optimized-server.py')
      } else {
        console.log('✅ Python FaceNet server is up — waiting for model to be ready...')
        const ready = await waitForModelReady()
        if (ready) {
          console.log('✅ FaceNet model ready')
        } else {
          console.warn('⚠️ Model load timed out — retries will happen automatically')
        }
        setModelsLoaded(true)
      }
    }
    checkServer()
  }, [])

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

    startFaceDetection()

    return () => {
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current)
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
      if (autoCaptureTimeoutRef.current) clearTimeout(autoCaptureTimeoutRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [showCamera, modelsLoaded])

  // Draw bounding box and recognition results on canvas
  useEffect(() => {
    if (!canvasRef.current || !videoRef.current) return

    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawLoop = () => {
      if (!showCamera) return

      // Match canvas size to video
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw bounding box if face detected
      if (boundingBox) {
        const { x, y, width, height } = boundingBox

        // Draw rectangle with green color for detected face
        ctx.strokeStyle = faceDetected ? '#10b981' : '#ef4444'
        ctx.lineWidth = 3
        ctx.strokeRect(x, y, width, height)

        // Draw corners for better visual
        const cornerLength = 30
        ctx.strokeStyle = faceDetected ? '#10b981' : '#ef4444'
        ctx.lineWidth = 5

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

        // Draw name label above the box
        if (recognizedName) {
          const labelText = recognizedName === 'Unknown' 
            ? 'Unknown Person' 
            : recognizedName
          const confidence = recognitionConfidence > 0 
            ? ` (${(recognitionConfidence * 100).toFixed(0)}%)` 
            : ''
          
          // Measure text
          ctx.font = 'bold 18px Arial'
          const textWidth = ctx.measureText(labelText + confidence).width
          
          // Background for text
          ctx.fillStyle = recognizedName === 'Unknown' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)'
          ctx.fillRect(x, y - 40, textWidth + 20, 35)

          // Text
          ctx.fillStyle = '#ffffff'
          ctx.fillText(labelText + confidence, x + 10, y - 15)
        }
      }

      requestAnimationFrame(drawLoop)
    }

    drawLoop()
  }, [boundingBox, faceDetected, recognizedName, recognitionConfidence, showCamera])

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isCapturing) return

      try {
        // Extract embedding via Python server (512D)
        const result = await extractFaceNetFromVideo(videoRef.current)

        if (result.detected && result.embedding) {
          setFaceDetected(true)
          const descriptor = new Float32Array(result.embedding)
          setFaceDescriptor(descriptor)
          
          // IMPORTANT: Save to ref IMMEDIATELY when detected (not just during capture)
          savedFaceDescriptorRef.current = descriptor
          console.log('✅ Face detected! Descriptor length:', descriptor.length, '- Saved to ref immediately')
          console.log('   Confidence:', result.confidence?.toFixed(3))

          // Perform face recognition
          recognizeFace(result.embedding)

          // Track consecutive face detections for stability
          consecutiveFaceDetectionsRef.current += 1

          // Auto capture with countdown - VERY forgiving, just need 1 detection
          if (autoCapture && !isCapturing && consecutiveFaceDetectionsRef.current >= 1) {
            // Face detected - start countdown immediately
            if (!faceStableStartRef.current) {
              faceStableStartRef.current = Date.now()
            }

            const CAPTURE_DELAY = 1200 // 1.2 seconds - faster capture
            const elapsed = Date.now() - faceStableStartRef.current
            const remaining = Math.max(0, CAPTURE_DELAY - elapsed)
            const countdown = Math.ceil(remaining / 1000)
            setCaptureCountdown(countdown)

            if (remaining <= 0 && !isCapturing) {
              // Time to capture!
              console.log('📸 Auto-capturing photo...')
              capturePhoto()
            }
          }
        } else {
          // Face lost - be EXTREMELY forgiving
          // Decrement very slowly - almost never reset
          if (consecutiveFaceDetectionsRef.current > 0) {
            consecutiveFaceDetectionsRef.current -= 0.25 // Even slower decay - very forgiving
          }
          
          // Only reset everything if face is lost for 8+ detection cycles (very patient)
          if (consecutiveFaceDetectionsRef.current <= 0) {
            consecutiveFaceDetectionsRef.current = 0
            setFaceDetected(false)
            setFaceDescriptor(null)
            setBoundingBox(null)
            setRecognizedName('')
            setRecognitionConfidence(0)
            faceStableStartRef.current = null
            setCaptureCountdown(0)
            
            if (autoCaptureTimeoutRef.current) {
              clearTimeout(autoCaptureTimeoutRef.current)
              autoCaptureTimeoutRef.current = null
            }
          }
          // Keep showing "face detected" state even during brief losses
          else {
            // Don't update UI - maintain the "detected" appearance
          }
        }
      } catch (error) {
        console.error('Face detection error:', error)
      }
    }, 300)
  }

  const recognizeFace = async (descriptor: number[]) => {
    try {
      const response = await fetch('/api/attendance/match-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faceDescriptor: descriptor })
      })

      const data = await response.json()

      if (data.matched && data.student) {
        setRecognizedName(`${data.student.firstName} ${data.student.lastName}`)
        setRecognitionConfidence(data.confidence || 0)
      } else {
        setRecognizedName('Unknown')
        setRecognitionConfidence(0)
      }
    } catch (error) {
      console.error('Face recognition error:', error)
      setRecognizedName('Unknown')
      setRecognitionConfidence(0)
    }
  }

  const startCamera = async () => {
    if (!modelsLoaded) {
      alert('Facial recognition models are still loading. Please wait...')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      })

      streamRef.current = stream
      setShowCamera(true)
    } catch (error: any) {
      console.error('Error accessing camera:', error)
      alert(`Unable to access camera: ${error.message}. Please check permissions and try again.`)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (captureTimeoutRef.current) {
      clearTimeout(captureTimeoutRef.current)
      captureTimeoutRef.current = null
    }
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current)
      detectionIntervalRef.current = null
    }
    if (autoCaptureTimeoutRef.current) {
      clearTimeout(autoCaptureTimeoutRef.current)
      autoCaptureTimeoutRef.current = null
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    setShowCamera(false)
    setIsCapturing(false)
    setFaceDetected(false)
    setFaceDescriptor(null)
    setBoundingBox(null)
    setRecognizedName('')
    setRecognitionConfidence(0)
    setCaptureCountdown(0)
    // NOTE: Don't clear savedFaceDescriptorRef - it must persist for submission!
    faceStableStartRef.current = null
    consecutiveFaceDetectionsRef.current = 0
  }

  const capturePhoto = () => {
    console.log('📸 Attempting to capture photo...')
    console.log('   - Face descriptor in state:', !!faceDescriptor, faceDescriptor?.length)
    console.log('   - Face descriptor in ref:', !!savedFaceDescriptorRef.current, savedFaceDescriptorRef.current?.length)
    console.log('   - Face detected flag:', faceDetected)
    console.log('   - Models loaded:', modelsLoaded)
    
    // Use descriptor from state OR ref
    const descriptorToCheck = faceDescriptor || savedFaceDescriptorRef.current
    
    // CRITICAL: Prevent capture if no face descriptor exists
    if (!descriptorToCheck) {
      console.error('❌ Cannot capture: No face descriptor detected')
      console.error('   State descriptor:', faceDescriptor)
      console.error('   Ref descriptor:', savedFaceDescriptorRef.current)
      console.error('   This usually means MediaPipe face detection is not working')
      alert('Face not detected! Please:\n1. Ensure your face is clearly visible\n2. Wait a moment for detection to activate\n3. Look directly at the camera')
      setIsCapturing(false)
      return
    }
    
    console.log('✅ Face descriptor confirmed, proceeding with capture')
    
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

        const imageData = canvas.toDataURL('image/jpeg', 0.9)
        setCapturedImage(imageData)
        
        // Reset all capture-related states
        faceStableStartRef.current = null
        consecutiveFaceDetectionsRef.current = 0
        setCaptureCountdown(0)
        
        console.log('✅ Photo captured successfully')
        
        stopCamera()
        
        // Restore the saved descriptor after stopping camera
        if (savedDescriptor) {
          setFaceDescriptor(savedDescriptor)
        }
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.firstName || !formData.lastName || !formData.studentNumber || !capturedImage) {
      alert('Please fill all required fields and capture your photo')
      return
    }

    setIsSubmitting(true)

    try {
      // Use descriptor from ref if state is null (more reliable)
      const descriptorToUse = faceDescriptor || savedFaceDescriptorRef.current
      
      // Convert face descriptor to a plain array that can be JSON serialized
      let descriptorArray = null
      if (descriptorToUse) {
        descriptorArray = Array.isArray(descriptorToUse) 
          ? descriptorToUse 
          : Array.from(descriptorToUse)
      }

      const requestBody = {
        studentId: formData.studentNumber,
        email: `${formData.firstName.toLowerCase()}.${formData.lastName.toLowerCase()}@student.edu`,
        firstName: formData.firstName,
        lastName: formData.lastName,
        middleInitial: formData.middleInitial,
        faceData: capturedImage,
        faceDescriptor: descriptorArray
      }

      console.log('📤 Sending registration with:', {
        ...requestBody,
        faceData: 'base64 image',
        faceDescriptorFromState: !!faceDescriptor,
        faceDescriptorFromRef: !!savedFaceDescriptorRef.current,
        faceDescriptorFinal: !!descriptorToUse,
        faceDescriptor: descriptorArray ? `array of ${descriptorArray.length} values` : null,
        descriptorSample: descriptorArray?.slice(0, 5)
      })

      const response = await fetch('/api/student/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()

      if (data.success) {
        // Broadcast event to notify other parts of the app that a new student was registered
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('student-registered', {
            detail: {
              studentId: formData.studentNumber,
              firstName: formData.firstName,
              lastName: formData.lastName,
              email: data.credentials?.email,
              timestamp: new Date().toISOString()
            }
          }))
          console.log('✅ Student registration event broadcasted')
        }

        // Also trigger a storage event for cross-tab communication
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('last-student-registration', JSON.stringify({
            studentId: formData.studentNumber,
            firstName: formData.firstName,
            lastName: formData.lastName,
            timestamp: new Date().toISOString()
          }))
        }

        alert('Facial registration completed successfully!')
        onComplete()
      } else {
        const errorMsg = data.error || 'Failed to register'
        alert(errorMsg)
      }
    } catch (error) {
      alert('Failed to register facial recognition: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900">Facial Recognition Setup</h2>
            <p className="text-sm text-gray-600 mt-2">
              Welcome, {studentName}! Please register your face to mark attendance automatically.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 p-6 overflow-y-auto flex-1">
            {/* Personal Information Fields */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-4">
                Personal Information
              </label>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Middle Initial
                  </label>
                  <input
                    type="text"
                    maxLength={1}
                    value={formData.middleInitial}
                    onChange={(e) => setFormData(prev => ({ ...prev, middleInitial: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., J"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Student Number *
                  </label>
                  <input
                    type="text"
                    value={formData.studentNumber}
                    onChange={(e) => setFormData(prev => ({ ...prev, studentNumber: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 2024-00001"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Camera Section */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Facial Photo
              </label>

              {!showCamera && !capturedImage && (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <Camera className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600 mb-4">Capture your photo for facial recognition</p>

                  <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <p className="text-sm font-medium text-emerald-700 mb-2">✓ Instant Auto-Capture Mode</p>
                    <p className="text-xs text-gray-600">
                      Just show your face to the camera - photo captures automatically in 1 second! No need to hold perfectly still.
                    </p>
                  </div>

                  {/* Controls */}
                  <div className="mb-4 flex items-center justify-center gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={autoCapture}
                        onChange={(e) => setAutoCapture(e.target.checked)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <span className="text-sm text-emerald-700 font-medium">Auto Capture (Recommended)</span>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Start Camera
                  </button>
                </div>
              )}

              {showCamera && (
                <div className="space-y-4">
                  <div className="relative bg-black rounded-lg overflow-hidden w-full" style={{ height: '500px' }}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', transform: 'scaleX(-1)' }}
                    />

                    {/* Canvas overlay for bounding box - Always show */}
                    <canvas
                      ref={canvasRef}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        transform: 'scaleX(-1)',
                        pointerEvents: 'none'
                      }}
                    />

                    {/* Status indicators */}
                    <div className="absolute top-6 left-0 right-0 flex flex-col items-center gap-3">
                      {faceDetected ? (
                        <>
                          <div className="bg-emerald-600/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg">
                            <p className="text-white font-bold text-base">
                              ✅ Face Detected {recognizedName && `- ${recognizedName}`}
                            </p>
                          </div>
                          {autoCapture && captureCountdown > 0 && (
                            <div className="bg-blue-600/95 backdrop-blur-sm px-8 py-4 rounded-full shadow-lg animate-pulse">
                              <p className="text-white text-2xl font-bold">
                                📸 Capturing...
                              </p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="bg-black/70 backdrop-blur-sm px-6 py-3 rounded-full">
                          <p className="text-white font-bold text-base">
                            📍 Show your face to the camera
                          </p>
                        </div>
                      )}
                    </div>


                    {/* Control buttons */}
                    <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3">
                      {!autoCapture && faceDetected && (
                        <button
                          type="button"
                          onClick={capturePhoto}
                          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-lg"
                        >
                          📸 Capture Photo Now
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="px-4 py-2 bg-red-600/80 text-white rounded-lg hover:bg-red-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>

                    {/* Recognition info panel */}
                    {faceDetected && (
                      <div className="absolute right-6 top-1/2 transform -translate-y-1/2 bg-black/70 backdrop-blur-sm rounded-lg p-4 flex flex-col gap-3">
                        <div className="text-xs font-bold text-white mb-2">Recognition Info</div>
                        <div className="flex items-center gap-2 text-blue-400">
                          <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                          <span className="text-xs">Face Detected</span>
                        </div>
                        {recognizedName && (
                          <>
                            <div className={`flex items-center gap-2 ${recognizedName !== 'Unknown' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                              <div className={`w-2 h-2 rounded-full ${recognizedName !== 'Unknown' ? 'bg-emerald-400' : 'bg-yellow-400'}`}></div>
                              <span className="text-xs">{recognizedName !== 'Unknown' ? 'Recognized' : 'Unknown Person'}</span>
                            </div>
                            {recognitionConfidence > 0 && (
                              <div className="mt-2 pt-2 border-t border-gray-600">
                                <div className="text-xs text-gray-400">Confidence</div>
                                <div className="text-sm font-bold text-blue-400">{(recognitionConfidence * 100).toFixed(1)}%</div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {capturedImage && !showCamera && (
                <div className="space-y-4">
                  <img
                    src={capturedImage}
                    alt="Captured"
                    className="w-full rounded-lg border-2 border-blue-300"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCapturedImage(null)
                      setFaceDescriptor(null)
                      setBoundingBox(null)
                      setRecognizedName('')
                      setRecognitionConfidence(0)
                      setCaptureCountdown(0)
                      faceStableStartRef.current = null
                      consecutiveFaceDetectionsRef.current = 0
                      startCamera()
                    }}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Retake Photo
                  </button>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <div className="pt-4 border-t border-gray-200 space-y-3">
              <button
                type="submit"
                disabled={isSubmitting || !capturedImage}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors font-medium"
              >
                {isSubmitting ? 'Registering...' : 'Complete Registration'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
