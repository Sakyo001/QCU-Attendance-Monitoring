'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Clock, Check, AlertCircle } from 'lucide-react'
import { checkFaceNetHealth, ServerCameraStream } from '@/lib/facenet-python-api'
import type { CameraStreamFrame } from '@/lib/facenet-python-api'

type AttendanceStatus = 'idle' | 'detecting' | 'success' | 'error'

export default function StudentAttendancePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [sessionActive, setSessionActive] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [antiSpoofStatus, setAntiSpoofStatus] = useState<'unknown' | 'live' | 'spoof'>('unknown')
  const [status, setStatus] = useState<AttendanceStatus>('idle')
  const [matchResult, setMatchResult] = useState<{
    studentName: string
    confidence: number
  } | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const serverCanvasRef = useRef<HTMLCanvasElement>(null)
  const serverStreamRef = useRef<ServerCameraStream | null>(null)
  const serverImgRef = useRef<HTMLImageElement | null>(null)
  const pendingFrameRef = useRef<CameraStreamFrame | null>(null)
  const rafRef = useRef<number>(0)
  const captureTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const livenessFramesRef = useRef(0)

  // Check face recognition server health (replaces face-api model loading)
  useEffect(() => {
    const checkServer = async () => {
      try {
        const healthy = await checkFaceNetHealth()
        setModelsLoaded(healthy)
        if (!healthy) {
          setErrorMessage('Face recognition server is not responding. Please ensure the Python server is running.')
        }
      } catch {
        setModelsLoaded(false)
      }
    }
    checkServer()
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

  const drawServerFrame = useCallback((data: CameraStreamFrame) => {
    const canvas = serverCanvasRef.current
    if (!canvas || !data.frame) return

    if (!serverImgRef.current) {
      serverImgRef.current = new Image()
    }
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

  const handleServerFrame = useCallback((data: CameraStreamFrame) => {
    // Queue frame for rAF rendering
    pendingFrameRef.current = data

    // Only process results on frames that ran through the pipeline
    if (data.results === null || data.results === undefined) return

    // Process results
    if (status === 'success' || status === 'error') return

    if (!data.results || data.results.length === 0) {
      setFaceDetected(false)
      setAntiSpoofStatus('unknown')
      livenessFramesRef.current = 0
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current)
        captureTimeoutRef.current = null
      }
      return
    }

    const face = data.results[0]
    setFaceDetected(true)

    if (face.spoof_detected) {
      livenessFramesRef.current = 0
      setAntiSpoofStatus('spoof')
      setErrorMessage('⚠️ Spoof attempt detected. Please use your real face.')
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current)
        captureTimeoutRef.current = null
      }
      return
    }

    if (!face.embedding) return

    setAntiSpoofStatus('live')
    setErrorMessage('')
    livenessFramesRef.current++

    if (livenessFramesRef.current >= 5 && !captureTimeoutRef.current) {
      captureTimeoutRef.current = setTimeout(async () => {
        await markAttendance(new Float32Array(face.embedding!))
      }, 300)
    }
  }, [status])

  // rAF loop — draws the latest queued frame
  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      const frame = pendingFrameRef.current
      if (frame) {
        pendingFrameRef.current = null
        drawServerFrame(frame)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [drawServerFrame])

  const startCamera = async () => {
    if (!modelsLoaded) {
      setErrorMessage('Facial recognition server is still loading. Please wait...')
      return
    }

    try {
      const stream = new ServerCameraStream()
      serverStreamRef.current = stream
      stream.start('extract', handleServerFrame, (err) => {
        console.error('Server camera error:', err)
        setErrorMessage('Camera connection error: ' + err)
      })
      setStatus('detecting')
      setErrorMessage('')
      setShowCamera(true)
    } catch (error: any) {
      console.error('Error connecting to server camera:', error)
      setErrorMessage(`Unable to connect to camera server: ${error.message}`)
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (serverStreamRef.current) {
        serverStreamRef.current.stop()
      }
      if (captureTimeoutRef.current) {
        clearTimeout(captureTimeoutRef.current)
      }
    }
  }, [])

  const stopCamera = () => {
    if (serverStreamRef.current) {
      serverStreamRef.current.stop()
      serverStreamRef.current = null
    }
    if (captureTimeoutRef.current) {
      clearTimeout(captureTimeoutRef.current)
      captureTimeoutRef.current = null
    }
    livenessFramesRef.current = 0
    setShowCamera(false)
    setFaceDetected(false)
    setAntiSpoofStatus('unknown')
    setStatus('idle')
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
              <canvas
                ref={serverCanvasRef}
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
              />

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-64 h-80">
                  <div className={`absolute inset-0 border-4 rounded-full transition-all ${faceDetected ? 'border-emerald-400' : 'border-blue-400'} opacity-60`}></div>
                </div>
              </div>

              <div className="absolute top-6 left-0 right-0 flex justify-center">
                <div className="bg-black/70 backdrop-blur-sm px-6 py-3 rounded-full">
                  <p className="text-white font-bold">
                {status === 'detecting' && (
                faceDetected
                  ? antiSpoofStatus === 'spoof'
                    ? '🚫 Spoof detected — use your real face'
                    : antiSpoofStatus === 'live'
                      ? `✅ Live face verified (${livenessFramesRef.current}/5)`
                      : '🔍 Face detected — analysing...'
                  : '👁️ Position your face in the camera'
              )}
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
