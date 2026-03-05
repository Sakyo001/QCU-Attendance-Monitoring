'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Loader2, Check, Camera, X, RefreshCw } from 'lucide-react'
import { extractFaceNetFromVideo, checkFaceNetHealth, waitForModelReady } from '@/lib/facenet-python-api'

interface EditFaceModalProps {
  student: any
  onClose: () => void
  onSuccess: () => void
}

export function EditFaceModal({ student, onClose, onSuccess }: EditFaceModalProps) {
  const [formData, setFormData] = useState({
    firstName: student.first_name || '',
    lastName: student.last_name || '',
    middleName: student.middle_name || '',
    studentId: student.student_id || '',
    email: student.email || ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loadingEmail, setLoadingEmail] = useState(false)

  // Face capture state
  const isPending = student.face_data === 'pending'
  const [showCamera, setShowCamera] = useState(false)
  const [modelsReady, setModelsReady] = useState(false)
  const [checkingServer, setCheckingServer] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null)
  const [captureCountdown, setCaptureCountdown] = useState(0)
  const [isSavingFace, setIsSavingFace] = useState(false)
  const [faceError, setFaceError] = useState('')
  const [faceSuccess, setFaceSuccess] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const faceStableStartRef = useRef<number | null>(null)
  const consecutiveDetectionsRef = useRef<number>(0)
  const savedDescriptorRef = useRef<number[] | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  // Fetch email from face_registrations (personal email from Excel) — runs on mount
  // to correct any stale MS365 email that may have been stored previously
  const fetchEmail = async () => {
    if (!student.student_id) return
    setLoadingEmail(true)
    try {
      const response = await fetch(`/api/professor/attendance/get-student-email?studentId=${student.student_id}`)
      const data = await response.json()
      if (data.success && data.email) {
        setFormData(prev => ({ ...prev, email: data.email }))
      }
    } catch (error) {
      console.error('Error fetching email:', error)
    } finally {
      setLoadingEmail(false)
    }
  }

  useEffect(() => {
    if (student.student_id) {
      fetchEmail()
    }
  }, [])

  // Start face detection loop when camera is active
  useEffect(() => {
    if (!showCamera || !streamRef.current || !videoRef.current || !modelsReady) return

    videoRef.current.srcObject = streamRef.current
    videoRef.current.play().catch(err => {
      console.error('Video autoplay failed:', err)
      setTimeout(() => videoRef.current?.play().catch(() => {}), 200)
    })

    startFaceDetection()

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current)
        detectionIntervalRef.current = null
      }
    }
  }, [showCamera, modelsReady])

  // Draw bounding box overlay
  useEffect(() => {
    if (!canvasRef.current || !videoRef.current || !showCamera) return
    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    const draw = () => {
      if (!showCamera) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (faceDetected) {
        // Draw green border effect
        ctx.strokeStyle = '#10b981'
        ctx.lineWidth = 4
        const inset = 20
        ctx.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2)
      }
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(animId)
  }, [showCamera, faceDetected])

  const initFaceServer = async () => {
    setCheckingServer(true)
    setFaceError('')
    try {
      const healthy = await checkFaceNetHealth()
      if (!healthy) {
        setFaceError('Face recognition server is not available. Please try again later.')
        setCheckingServer(false)
        return false
      }
      await waitForModelReady()
      setModelsReady(true)
      setCheckingServer(false)
      return true
    } catch (err) {
      setFaceError('Could not connect to face recognition server.')
      setCheckingServer(false)
      return false
    }
  }

  const startCamera = async () => {
    setFaceError('')
    setCapturedImage(null)
    setFaceDescriptor(null)
    savedDescriptorRef.current = null
    setFaceSuccess(false)

    // Check server first if models not ready
    if (!modelsReady) {
      const ok = await initFaceServer()
      if (!ok) return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      })
      streamRef.current = stream
      setShowCamera(true)
    } catch (err: any) {
      setFaceError(`Camera access denied: ${err.message}`)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current)
      detectionIntervalRef.current = null
    }
    setShowCamera(false)
    setFaceDetected(false)
    setCaptureCountdown(0)
    faceStableStartRef.current = null
    consecutiveDetectionsRef.current = 0
  }

  const startFaceDetection = () => {
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current) return
      try {
        const result = await extractFaceNetFromVideo(videoRef.current)
        if (result.detected && result.embedding) {
          setFaceDetected(true)
          const desc = Array.from(result.embedding)
          savedDescriptorRef.current = desc
          consecutiveDetectionsRef.current += 1

          // Auto-capture countdown after stable detection
          if (consecutiveDetectionsRef.current >= 2) {
            if (!faceStableStartRef.current) faceStableStartRef.current = Date.now()
            const elapsed = Date.now() - faceStableStartRef.current
            const remaining = Math.max(0, 1500 - elapsed)
            setCaptureCountdown(Math.ceil(remaining / 1000))

            if (remaining <= 0) {
              capturePhoto()
            }
          }
        } else {
          consecutiveDetectionsRef.current = Math.max(0, consecutiveDetectionsRef.current - 0.5)
          if (consecutiveDetectionsRef.current <= 0) {
            setFaceDetected(false)
            faceStableStartRef.current = null
            setCaptureCountdown(0)
          }
        }
      } catch (err) {
        console.error('Face detection error:', err)
      }
    }, 350)
  }

  const capturePhoto = () => {
    if (!videoRef.current || !savedDescriptorRef.current) return

    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(videoRef.current, 0, 0)
      const imgData = canvas.toDataURL('image/jpeg', 0.9)
      setCapturedImage(imgData)
      setFaceDescriptor(savedDescriptorRef.current)
    }
    stopCamera()
  }

  const saveFaceData = async () => {
    if (!capturedImage || !faceDescriptor) return

    setIsSavingFace(true)
    setFaceError('')
    try {
      const response = await fetch('/api/professor/attendance/update-face', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: student.id,
          faceData: capturedImage,
          faceDescriptor: faceDescriptor
        })
      })
      const data = await response.json()
      if (!response.ok) {
        setFaceError(data.error || 'Failed to save face data')
        return
      }
      setFaceSuccess(true)
      // Auto-close after brief delay
      setTimeout(() => onSuccess(), 1000)
    } catch (err: any) {
      setFaceError('Failed to save face data: ' + err.message)
    } finally {
      setIsSavingFace(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch(`/api/professor/attendance/update-student`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: student.id,
          firstName: formData.firstName,
          lastName: formData.lastName,
          middleName: formData.middleName,
          studentId: formData.studentId,
          email: formData.email
        })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to update student')
        return
      }

      onSuccess()
    } catch (error) {
      console.error('Error updating student:', error)
      setError('Failed to update student information')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Edit Student</CardTitle>
          <CardDescription>
            Update student details{isPending ? ' and register their face' : ''}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Student Avatar */}
          <div className="flex justify-center mb-2">
            {capturedImage ? (
              <div className="relative">
                <img
                  src={capturedImage}
                  alt="Captured face"
                  className="h-20 w-20 rounded-full object-cover border-2 border-emerald-400"
                />
                {!faceSuccess && (
                  <button
                    type="button"
                    onClick={() => { setCapturedImage(null); setFaceDescriptor(null); savedDescriptorRef.current = null }}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : (
              <Avatar className="h-20 w-20 border-2 border-gray-200">
                <AvatarImage src={student.avatar_url || ''} />
                <AvatarFallback className={`${isPending ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'} text-xl font-bold`}>
                  {student.first_name?.charAt(0) || ''}{student.last_name?.charAt(0) || ''}
                </AvatarFallback>
              </Avatar>
            )}
          </div>

          {/* Face Registration Section */}
          {(isPending || capturedImage || showCamera) && (
            <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">
                  {isPending && !capturedImage && !faceSuccess ? '⚠️ No face registered' : faceSuccess ? '✅ Face captured!' : '📸 Face Capture'}
                </p>
                {!showCamera && !capturedImage && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={startCamera}
                    disabled={checkingServer}
                    className="gap-1 text-xs"
                  >
                    {checkingServer ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Connecting...</>
                    ) : (
                      <><Camera className="h-3 w-3" /> Open Camera</>
                    )}
                  </Button>
                )}
              </div>

              {/* Camera View */}
              {showCamera && (
                <div className="relative rounded-lg overflow-hidden bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-auto transform -scale-x-100"
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full transform -scale-x-100"
                  />

                  {/* Status overlay */}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <span className={`text-xs px-2 py-1 rounded ${faceDetected ? 'bg-emerald-500/90 text-white' : 'bg-gray-800/70 text-gray-300'}`}>
                      {faceDetected
                        ? captureCountdown > 0
                          ? `Face detected — capturing in ${captureCountdown}...`
                          : 'Face detected ✓'
                        : 'Looking for face...'}
                    </span>
                    <button
                      onClick={stopCamera}
                      className="bg-red-500/90 text-white text-xs px-2 py-1 rounded hover:bg-red-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Captured face preview + save */}
              {capturedImage && faceDescriptor && !faceSuccess && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveFaceData}
                    disabled={isSavingFace}
                    className="flex-1 gap-1 text-xs"
                  >
                    {isSavingFace ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</>
                    ) : (
                      <><Check className="h-3 w-3" /> Save Face Data</>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={startCamera}
                    disabled={isSavingFace}
                    className="gap-1 text-xs"
                  >
                    <RefreshCw className="h-3 w-3" /> Retake
                  </Button>
                </div>
              )}

              {faceSuccess && (
                <p className="text-xs text-emerald-600 font-medium">Face registered successfully!</p>
              )}

              {faceError && (
                <p className="text-xs text-red-600">{faceError}</p>
              )}
            </div>
          )}

          {/* Non-pending students: show a button to re-capture face */}
          {!isPending && !showCamera && !capturedImage && (
            <div className="flex justify-center">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={startCamera}
                disabled={checkingServer}
                className="gap-1 text-xs text-gray-500"
              >
                <Camera className="h-3 w-3" /> Re-capture Face
              </Button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded border border-red-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name
              </label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Middle Name
              </label>
              <input
                type="text"
                name="middleName"
                value={formData.middleName}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name
              </label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Student ID
              </label>
              <input
                type="text"
                name="studentId"
                value={formData.studentId}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                disabled={loadingEmail}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
              {loadingEmail && <p className="text-xs text-gray-500 mt-1">Loading email...</p>}
            </div>

            <div className="pt-2 flex gap-2">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save Info
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting || isSavingFace}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
