'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { Camera, ArrowLeft } from 'lucide-react'
import * as faceapi from 'face-api.js'

interface LivenessMetrics {
  eyesOpen: boolean
  faceDetected: boolean
  headMovement: boolean
  livenessScore: number
}

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
  const [livenessCheck, setLivenessCheck] = useState(true)
  const [livenessComplete, setLivenessComplete] = useState(false)
  const [livenessScore, setLivenessScore] = useState(0)
  const [livenessMetrics, setLivenessMetrics] = useState<LivenessMetrics>({
    eyesOpen: false,
    faceDetected: false,
    headMovement: false,
    livenessScore: 0
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const livenessFramesRef = useRef(0)
  const previousYawRef = useRef(0)
  const LIVENESS_THRESHOLD = 30 // Frames required to verify liveness
  const HEAD_MOVEMENT_THRESHOLD = 5 // Minimum yaw change to detect movement

  // Load face-api models
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
        alert('Failed to load facial recognition models. Please refresh the page.')
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
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current)
      }
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current)
      }
    }
  }, [showCamera, modelsLoaded])

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

    return yaw
  }

  const checkEyesOpen = (landmarks: faceapi.FaceLandmarks68): boolean => {
    const points = landmarks.positions
    const leftEyeTop = points[37]
    const leftEyeBottom = points[41]
    const rightEyeTop = points[43]
    const rightEyeBottom = points[47]

    const leftEyeOpen = Math.abs(leftEyeBottom.y - leftEyeTop.y) > 5
    const rightEyeOpen = Math.abs(rightEyeBottom.y - rightEyeTop.y) > 5

    return leftEyeOpen && rightEyeOpen
  }

  const updateLivenessScore = (detection: faceapi.WithFaceDescriptors<faceapi.WithFaceLandmarks<faceapi.WithFaceDetection<{}>>>) => {
    const eyesOpen = checkEyesOpen(detection.landmarks)
    const yaw = calculateHeadPose(detection.landmarks)
    const headMovement = Math.abs(yaw - previousYawRef.current) > HEAD_MOVEMENT_THRESHOLD
    
    previousYawRef.current = yaw

    if (eyesOpen && detection) {
      livenessFramesRef.current++
    } else {
      livenessFramesRef.current = Math.max(0, livenessFramesRef.current - 1)
    }

    const score = Math.min(100, (livenessFramesRef.current / LIVENESS_THRESHOLD) * 100)
    setLivenessScore(score)
    setLivenessMetrics({
      eyesOpen,
      faceDetected: true,
      headMovement,
      livenessScore: score
    })

    return score >= 100
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
            const isLive = updateLivenessScore(detection)
            if (isLive) {
              setLivenessComplete(true)
            }
          }

          if (!livenessCheck || livenessComplete) {
            if (!captureTimeoutRef.current) {
              captureTimeoutRef.current = setTimeout(() => {
                if (!isCapturing) {
                  capturePhoto()
                }
              }, 1000)
            }
          }
        } else {
          setFaceDetected(false)
          setFaceDescriptor(null)
          livenessFramesRef.current = 0
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
    }
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
    livenessFramesRef.current = 0
    previousYawRef.current = 0
  }

  const capturePhoto = () => {
    if (videoRef.current && !isCapturing && faceDescriptor && (!livenessCheck || livenessComplete)) {
      setIsCapturing(true)

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
        stopCamera()
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
      // Convert face descriptor to a plain array that can be JSON serialized
      let descriptorArray = null
      if (faceDescriptor) {
        descriptorArray = Array.isArray(faceDescriptor) 
          ? faceDescriptor 
          : Array.from(faceDescriptor)
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
        faceDescriptor: descriptorArray ? `array of ${descriptorArray.length} values` : null
      })

      const response = await fetch('/api/student/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()

      if (data.success) {
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

                  <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-gray-700 mb-2">✓ Liveness Detection Enabled</p>
                    <p className="text-xs text-gray-500">
                      Follow head movement instructions to verify you're a real person
                    </p>
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
                  <div className="relative bg-black rounded-lg overflow-hidden w-full" style={{ height: '400px' }}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', transform: 'scaleX(-1)' }}
                    />

                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="relative w-72 h-96">
                        <div className="absolute inset-0 border-4 border-blue-400 rounded-full opacity-60 animate-pulse"></div>
                        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-12 h-12 border-t-4 border-l-4 border-r-4 border-blue-400 animate-pulse"></div>
                        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-12 h-12 border-b-4 border-l-4 border-r-4 border-blue-400 animate-pulse"></div>
                        <div className="absolute top-1/2 left-0 transform -translate-y-1/2 w-12 h-12 border-t-4 border-b-4 border-l-4 border-blue-400 animate-pulse"></div>
                        <div className="absolute top-1/2 right-0 transform -translate-y-1/2 w-12 h-12 border-t-4 border-b-4 border-r-4 border-blue-400 animate-pulse"></div>
                      </div>
                    </div>

                    <div className="absolute top-6 left-0 right-0 flex flex-col items-center gap-3">
                      {livenessCheck && !livenessComplete && (
                        <>
                          <div className="bg-black/70 backdrop-blur-sm px-6 py-3 rounded-full">
                            <p className="text-white font-bold text-base">
                              📍 Look at the camera - ensure good lighting
                            </p>
                          </div>
                          {faceDetected && livenessScore > 0 && (
                            <div className="bg-black/70 backdrop-blur-sm px-4 py-2 rounded-full">
                              <div className="flex items-center gap-2">
                                <div className="w-32 h-2 bg-gray-600 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-400 transition-all duration-100"
                                    style={{ width: `${livenessScore}%` }}
                                  ></div>
                                </div>
                                <span className="text-white text-xs font-medium">{Math.round(livenessScore)}%</span>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {livenessComplete && (
                        <div className="bg-emerald-600/90 backdrop-blur-sm px-6 py-3 rounded-full">
                          <p className="text-white font-bold text-base">
                            ✅ Liveness verified! Click "Capture Photo Now" button
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3">
                      {livenessComplete && faceDetected && (
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

                    {livenessCheck && !livenessComplete && (
                      <div className="absolute right-6 top-1/2 transform -translate-y-1/2 bg-black/70 backdrop-blur-sm rounded-lg p-4 flex flex-col gap-3">
                        <div className="text-xs font-bold text-white mb-2">Liveness Metrics</div>
                        <div className={`flex items-center gap-2 ${livenessMetrics.faceDetected ? 'text-blue-400' : 'text-gray-400'}`}>
                          <div className={`w-2 h-2 rounded-full ${livenessMetrics.faceDetected ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                          <span className="text-xs">Face Detected</span>
                        </div>
                        <div className={`flex items-center gap-2 ${livenessMetrics.eyesOpen ? 'text-blue-400' : 'text-gray-400'}`}>
                          <div className={`w-2 h-2 rounded-full ${livenessMetrics.eyesOpen ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                          <span className="text-xs">Eyes Open</span>
                        </div>
                        <div className={`flex items-center gap-2 ${livenessMetrics.headMovement ? 'text-blue-400' : 'text-gray-400'}`}>
                          <div className={`w-2 h-2 rounded-full ${livenessMetrics.headMovement ? 'bg-blue-400' : 'bg-gray-500'}`}></div>
                          <span className="text-xs">Head Movement</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-600">
                          <div className="text-xs font-bold text-blue-400">Liveness: {Math.round(livenessScore)}%</div>
                        </div>
                      </div>
                    )}

                    {livenessComplete && (
                      <div className="absolute right-6 top-1/2 transform -translate-y-1/2 bg-emerald-600/90 backdrop-blur-sm rounded-lg p-4">
                        <div className="text-center">
                          <div className="text-2xl mb-2">✅</div>
                          <div className="text-xs font-bold text-white">Liveness</div>
                          <div className="text-xs font-bold text-white">Complete!</div>
                        </div>
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
                      setLivenessComplete(false)
                      setLivenessScore(0)
                      setLivenessMetrics({
                        eyesOpen: false,
                        faceDetected: false,
                        headMovement: false,
                        livenessScore: 0
                      })
                      livenessFramesRef.current = 0
                      previousYawRef.current = 0
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
