'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { Clock, Check, AlertCircle } from 'lucide-react'
import * as faceapi from 'face-api.js'
import { usePassiveLivenessDetection } from '@/hooks/usePassiveLivenessDetection'

type AttendanceStatus = 'idle' | 'detecting' | 'success' | 'error'

export default function StudentAttendancePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [sessionActive, setSessionActive] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [status, setStatus] = useState<AttendanceStatus>('idle')
  const [matchResult, setMatchResult] = useState<{
    studentName: string
    confidence: number
  } | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const { livenessScore, livenessMetrics, updateLivenessScore, resetLiveness } = usePassiveLivenessDetection()

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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
        setErrorMessage('Failed to load facial recognition models. Please refresh the page.')
      }
    }
    loadModels()
  }, [])

  useEffect(() => {
    if (!loading && (!user || user.role !== 'student')) {
      router.push('/student/login')
      return
    }

    if (!loading && user) {
      checkSessionStatus()
    }
  }, [user, loading, router])

  const checkSessionStatus = async () => {
    try {
      setCheckingSession(true)
      // Check if there's an active shift opened by professor
      const response = await fetch('/api/professor/attendance/session?check=true')
      const data = await response.json()

      if (data.success && data.isActive) {
        setSessionActive(true)
      } else {
        setSessionActive(false)
        setErrorMessage('No active session. Please wait for your professor to start the attendance session.')
      }
    } catch (error) {
      console.error('Error checking session:', error)
      setSessionActive(false)
    } finally {
      setCheckingSession(false)
    }
  }

  const startCamera = async () => {
    if (!modelsLoaded) {
      setErrorMessage('Facial recognition models are still loading. Please wait...')
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

      // Store stream reference BEFORE showing camera
      streamRef.current = stream
      setStatus('detecting')
      setErrorMessage('')
      
      // Use requestAnimationFrame to ensure video element is mounted before showing
      requestAnimationFrame(() => {
        setShowCamera(true)
      })
    } catch (error: any) {
      console.error('Error accessing camera:', error)
      setErrorMessage(`Unable to access camera: ${error.message}. Please check permissions and try again.`)
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
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current)
      }
    }
  }, [showCamera])

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current)
    }
    if (captureTimeoutRef.current) {
      clearTimeout(captureTimeoutRef.current)
    }
    setShowCamera(false)
    setFaceDetected(false)
    setStatus('idle')
    resetLiveness()
  }

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || status === 'success' || status === 'error') return

      try {
        const detection = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor()

        if (detection) {
          setFaceDetected(true)

          // Check liveness
          const isLive = updateLivenessScore(detection)
          
          // Auto-capture once liveness is verified
          if (isLive && !captureTimeoutRef.current) {
            captureTimeoutRef.current = setTimeout(async () => {
              await markAttendance(detection.descriptor)
            }, 500)
          }
        } else {
          setFaceDetected(false)
          resetLiveness()
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

  const markAttendance = async (faceDescriptor: Float32Array) => {
    if (!user || status !== 'detecting') return

    try {
      setStatus('detecting')
      stopCamera()

      // Call face matching API
      const matchResponse = await fetch('/api/student/face-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          faceDescriptor: Array.from(faceDescriptor),
          studentId: user.id
        })
      })

      const matchData = await matchResponse.json()

      if (!matchData.success) {
        setStatus('error')
        setErrorMessage(matchData.error || 'Failed to identify face')
        return
      }

      if (matchData.identified) {
        // Face matched - mark attendance
        const attendanceResponse = await fetch('/api/student/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: user.id
          })
        })

        const attendanceData = await attendanceResponse.json()

        if (attendanceData.success) {
          setStatus('success')
          setMatchResult({
            studentName: `${user.firstName} ${user.lastName}`,
            confidence: matchData.confidence
          })
        } else {
          setStatus('error')
          setErrorMessage(attendanceData.error || 'Failed to mark attendance')
        }
      } else {
        setStatus('error')
        setErrorMessage('Face does not match registered student. Please try again.')
      }
    } catch (error) {
      setStatus('error')
      setErrorMessage('Error: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  if (loading || checkingSession) {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Mark Attendance</h1>
          <p className="text-gray-600 mt-2">Welcome, {user?.firstName}! Use facial recognition to mark your attendance.</p>
        </div>

        {/* Session Status */}
        {!sessionActive && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-yellow-800">No Active Session</p>
                <p className="text-sm text-yellow-700 mt-1">
                  No professor has started an attendance session yet. Please wait and try again later.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {errorMessage && status !== 'success' && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-red-800">Error</p>
                <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        {!showCamera && status === 'idle' && sessionActive && (
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-10 h-10 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Ready to Mark Attendance?</h2>
            <p className="text-gray-600 mb-6">
              Click the button below to use facial recognition to mark your attendance.
            </p>
            <button
              onClick={startCamera}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              📸 Start Face Recognition
            </button>
          </div>
        )}

        {/* Camera View */}
        {showCamera && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="relative bg-black" style={{ height: '480px' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', transform: 'scaleX(-1)' }}
              />

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-64 h-80">
                  <div className={`absolute inset-0 border-4 rounded-full transition-all ${faceDetected ? 'border-emerald-400' : 'border-blue-400'} opacity-60`}></div>
                </div>
              </div>

              <div className="absolute top-6 left-0 right-0 flex justify-center">
                <div className="bg-black/70 backdrop-blur-sm px-6 py-3 rounded-full">
                  <p className="text-white font-bold">
                    {status === 'detecting' && livenessScore < 100 && `👁️ Verifying liveness... ${Math.round(livenessScore)}%`}
                    {status === 'detecting' && livenessScore === 100 && '✅ Liveness verified!'}
                    {status === 'success' && '✅ Attendance marked!'}
                    {status === 'error' && '❌ Error occurred'}
                  </p>
                </div>
              </div>

              <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3">
                <button
                  onClick={stopCamera}
                  className="px-4 py-2 bg-red-600/80 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>

            {status === 'detecting' && (
              <div className="p-4 text-center">
                <div className="inline-block">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <p className="text-gray-600 mt-2">Processing facial recognition...</p>
              </div>
            )}

            {status === 'success' && matchResult && (
              <div className="p-6 bg-emerald-50 border-t border-emerald-200">
                <div className="text-center">
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Check className="w-6 h-6 text-emerald-600" />
                  </div>
                  <p className="text-lg font-bold text-emerald-900">Attendance Marked!</p>
                  <p className="text-sm text-emerald-700 mt-1">
                    {matchResult.studentName} - Confidence: {(matchResult.confidence * 100).toFixed(1)}%
                  </p>
                  <button
                    onClick={() => {
                      setStatus('idle')
                      setMatchResult(null)
                      setErrorMessage('')
                    }}
                    className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    Mark Another Student
                  </button>
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="p-6 bg-red-50 border-t border-red-200">
                <button
                  onClick={() => {
                    setStatus('idle')
                    setErrorMessage('')
                  }}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
