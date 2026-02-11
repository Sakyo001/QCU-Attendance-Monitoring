'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, UserPlus, Camera, RefreshCw, ShieldCheck, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/utils/supabase/client'
import { initializeFaceDetection, detectFaceInVideo } from '@/lib/mediapipe-face'
import { extractFaceNetFromVideo, checkFaceNetHealth } from '@/lib/facenet-python-api'

interface Section {
  id: string
  section_code: string
  semester: string
  academic_year: string
  max_students: number
}

export default function AddFacultyPage() {
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

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
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [captureCountdown, setCaptureCountdown] = useState<number | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [serverHealthy, setServerHealthy] = useState(true)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const savedFaceDescriptorRef = useRef<Float32Array | null>(null)
  const faceStableStartRef = useRef<number | null>(null)
  const consecutiveFaceDetectionsRef = useRef<number>(0)

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      router.push('/admin/login')
    }
  }, [user, router])

  // Load MediaPipe models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const loaded = await initializeFaceDetection()
        setModelsLoaded(loaded)
        if (loaded) {
          console.log('✅ MediaPipe models loaded for Faculty Registration')
        }
      } catch (error) {
        console.error('Error loading MediaPipe:', error)
      }
    }
    loadModels()
  }, [])

  // Check Python FaceNet server health
  useEffect(() => {
    const checkServer = async () => {
      const healthy = await checkFaceNetHealth()
      setServerHealthy(healthy)
      if (!healthy) {
        console.warn('⚠️ Python FaceNet server not responding')
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

    const drawFrame = () => {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
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
        const labelText = '✓ Face Detected - Ready to Capture'
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
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [showCamera])

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isCapturing) return

      try {
        const [mediapipeResult, pythonResult] = await Promise.all([
          detectFaceInVideo(videoRef.current!),
          extractFaceNetFromVideo(videoRef.current!)
        ])

        // Use MediaPipe for bounding box
        if (mediapipeResult.detected && mediapipeResult.boundingBox && videoRef.current) {
          const video = videoRef.current
          const { xCenter, yCenter, width, height } = mediapipeResult.boundingBox
          
          const pixelX = (xCenter - width / 2) * video.videoWidth
          const pixelY = (yCenter - height / 2) * video.videoHeight
          const pixelWidth = width * video.videoWidth
          const pixelHeight = height * video.videoHeight
          
          const padding = 40
          setBoundingBox({
            x: Math.max(0, pixelX - padding),
            y: Math.max(0, pixelY - padding),
            width: Math.min(video.videoWidth - pixelX + padding, pixelWidth + padding * 2),
            height: Math.min(video.videoHeight - pixelY + padding, pixelHeight + padding * 2)
          })
        } else {
          setBoundingBox(null)
        }

        // Use Python FaceNet for embedding
        if (pythonResult.detected && pythonResult.embedding) {
          setFaceDetected(true)
          const descriptor = new Float32Array(pythonResult.embedding)
          setFaceDescriptor(descriptor)
          savedFaceDescriptorRef.current = descriptor
          
          // Auto-capture countdown
          consecutiveFaceDetectionsRef.current += 1
          
          if (!isCapturing && consecutiveFaceDetectionsRef.current >= 1) {
            if (!faceStableStartRef.current) {
              faceStableStartRef.current = Date.now()
            }
            
            const CAPTURE_DELAY = 1500
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
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    
    setShowCamera(false)
    setIsCapturing(false)
    setFaceDetected(false)
    setBoundingBox(null)
    setCaptureCountdown(null)
    
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
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!capturedImage || !savedFaceDescriptorRef.current) {
      setError('Please capture a face photo for the faculty member')
      return
    }

    setIsSubmitting(true)

    try {
      const descriptorArray = Array.from(savedFaceDescriptorRef.current)

      const response = await fetch('/api/admin/faculty/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          employeeId: formData.employeeId,
          role: formData.role,
          contactNumber: formData.contactNumber,
          faceData: capturedImage,
          faceDescriptor: descriptorArray
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create faculty member')
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
                <ShieldCheck className="h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-600 mb-6 text-center max-w-sm">
                  Position the faculty member&apos;s face in front of the camera. Ensure good lighting.
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
                  <p className="text-amber-600 text-sm mt-3">⚠️ Face server unavailable - start python facenet-server.py</p>
                )}
              </div>
            )}

            {showCamera && (
              <div className="relative rounded-xl overflow-hidden bg-black shadow-xl" style={{ height: '450px' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover transform scale-x-[-1]"
                />

                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none transform scale-x-[-1]"
                />

                {/* Status indicators */}
                <div className="absolute top-4 inset-x-0 flex flex-col items-center pointer-events-none gap-2">
                  <div className={`text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2 ${
                    faceDetected ? 'bg-emerald-600/90' : 'bg-black/80'
                  }`}>
                    {faceDetected ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        Real-time Face Detection Active
                      </>
                    ) : (
                      '📷 Position face in the camera'
                    )}
                  </div>
                  
                  {faceDetected && captureCountdown !== null && captureCountdown > 0 && (
                    <div className="bg-emerald-600 text-white text-sm font-bold px-4 py-2 rounded-full backdrop-blur-md animate-pulse flex items-center gap-2">
                      <Camera className="w-4 h-4" />
                      Auto-capturing in {captureCountdown}s...
                    </div>
                  )}
                  
                  {!faceDetected && (
                    <div className="bg-red-600/90 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-md mt-2">
                      No face detected
                    </div>
                  )}
                </div>

                <div className="absolute bottom-4 inset-x-0 flex justify-center gap-4 px-4 z-10">
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={capturePhoto}
                    disabled={!faceDetected}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-500 transition-colors flex items-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    Capture Now
                  </button>
                </div>
              </div>
            )}

            {capturedImage && !showCamera && (
              <div className="relative rounded-xl overflow-hidden border-2 border-emerald-500 bg-gray-100">
                <img src={capturedImage} alt="Captured" className="w-full h-64 object-cover" />
                <div className="absolute top-3 left-3 bg-emerald-600 text-white text-xs font-medium px-3 py-1 rounded-full">
                  ✓ Face Captured
                </div>
                <div className="absolute bottom-3 right-3">
                  <button
                    type="button"
                    onClick={() => {
                      setCapturedImage(null)
                      savedFaceDescriptorRef.current = null
                      startCamera()
                    }}
                    className="flex items-center gap-2 px-3 py-2 bg-white/90 text-gray-700 rounded-lg hover:bg-white transition-colors text-sm font-medium"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retake
                  </button>
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
                  Email Address (Optional)
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
                  Contact Number
                </label>
                <input
                  type="tel"
                  id="contactNumber"
                  name="contactNumber"
                  value={formData.contactNumber}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
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
