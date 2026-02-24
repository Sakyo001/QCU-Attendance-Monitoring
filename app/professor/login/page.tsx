'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GraduationCap, Camera, AlertCircle, CheckCircle2, Loader2, RefreshCw, Scan } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { initializeFaceDetection, detectFaceInVideo } from '@/lib/mediapipe-face'
import { extractFaceNetFromVideo, checkFaceNetHealth, waitForModelReady } from '@/lib/facenet-python-api'

export default function ProfessorLoginPage() {
  const router = useRouter()
  const { signInWithId } = useAuth()
  
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [serverHealthy, setServerHealthy] = useState(true)
  const [cameraActive, setCameraActive] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [matchStatus, setMatchStatus] = useState<'idle' | 'scanning' | 'matched' | 'not-found'>('idle')
  const [matchedProfessor, setMatchedProfessor] = useState<{ firstName: string; lastName: string } | null>(null)
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMatchingRef = useRef<boolean>(false)

  // Load MediaPipe models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const loaded = await initializeFaceDetection()
        setModelsLoaded(loaded)
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
      if (healthy) waitForModelReady()
    }
    checkServer()
  }, [])

  // Canvas drawing effect
  useEffect(() => {
    if (!cameraActive || !canvasRef.current || !videoRef.current) return

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
        
        const boxColor = matchStatus === 'matched' ? '#10b981' : 
                         matchStatus === 'not-found' ? '#ef4444' : 
                         faceDetected ? '#3b82f6' : '#6b7280'
        
        ctx.shadowColor = boxColor
        ctx.shadowBlur = 20
        ctx.strokeStyle = boxColor
        ctx.lineWidth = 4
        ctx.strokeRect(x, y, width, height)
        ctx.shadowBlur = 0
        
        const cornerLength = 35
        ctx.lineWidth = 5
        ctx.lineCap = 'round'
        
        // Draw corners
        ctx.beginPath()
        ctx.moveTo(x, y + cornerLength)
        ctx.lineTo(x, y)
        ctx.lineTo(x + cornerLength, y)
        ctx.stroke()
        
        ctx.beginPath()
        ctx.moveTo(x + width - cornerLength, y)
        ctx.lineTo(x + width, y)
        ctx.lineTo(x + width, y + cornerLength)
        ctx.stroke()
        
        ctx.beginPath()
        ctx.moveTo(x, y + height - cornerLength)
        ctx.lineTo(x, y + height)
        ctx.lineTo(x + cornerLength, y + height)
        ctx.stroke()
        
        ctx.beginPath()
        ctx.moveTo(x + width - cornerLength, y + height)
        ctx.lineTo(x + width, y + height)
        ctx.lineTo(x + width, y + height - cornerLength)
        ctx.stroke()

        // Draw status label
        if (matchedProfessor || matchStatus !== 'idle') {
          const labelText = matchStatus === 'matched' 
            ? `✓ Welcome, ${matchedProfessor?.firstName} ${matchedProfessor?.lastName}!`
            : matchStatus === 'not-found'
              ? '✗ Face not recognized'
              : matchStatus === 'scanning'
                ? '🔍 Scanning...'
                : ''
          
          if (labelText) {
            ctx.font = 'bold 16px system-ui, sans-serif'
            const textWidth = ctx.measureText(labelText).width
            const padding = 12
            const labelHeight = 32
            
            const bgColor = matchStatus === 'matched' ? 'rgba(16, 185, 129, 0.95)' : 
                            matchStatus === 'not-found' ? 'rgba(239, 68, 68, 0.95)' : 
                            'rgba(59, 130, 246, 0.95)'
            
            ctx.fillStyle = bgColor
            ctx.beginPath()
            const labelX = x
            const labelY = y - labelHeight - 8
            ctx.roundRect(labelX, labelY, textWidth + padding * 2, labelHeight, 6)
            ctx.fill()
            
            ctx.save()
            ctx.scale(-1, 1)
            ctx.fillStyle = 'white'
            ctx.fillText(labelText, -(labelX + padding + textWidth), labelY + 22)
            ctx.restore()
          }
        }
      }

      animationId = requestAnimationFrame(drawFrame)
    }

    drawFrame()

    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [cameraActive, boundingBox, matchStatus, matchedProfessor, faceDetected])

  // Start camera and face detection
  useEffect(() => {
    if (!cameraActive || !streamRef.current || !videoRef.current) return

    videoRef.current.srcObject = streamRef.current
    
    const playPromise = videoRef.current.play()
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.play().catch(() => {})
          }
        }, 100)
      })
    }

    startFaceDetection()

    return () => {
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
    }
  }, [cameraActive])

  const startFaceDetection = async () => {
    if (!videoRef.current || !modelsLoaded) return

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isLoading) return

      try {
        const [mediapipeResult, pythonResult] = await Promise.all([
          detectFaceInVideo(videoRef.current!),
          extractFaceNetFromVideo(videoRef.current!)
        ])

        // Update bounding box
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

        // Face matching - Real-time without throttle
        if (pythonResult.detected && pythonResult.embedding) {
          setFaceDetected(true)
          
          // Prevent concurrent requests and stop if already matched or loading
          if (!isMatchingRef.current && matchStatus !== 'matched' && !isLoading) {
            isMatchingRef.current = true
            setMatchStatus('scanning')
            
            try {
              const response = await fetch('/api/professor/face-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faceDescriptor: pythonResult.embedding })
              })
              
              const data = await response.json()
              
              if (data.matched && data.professor) {
                setMatchStatus('matched')
                setMatchedProfessor({ 
                  firstName: data.professor.firstName, 
                  lastName: data.professor.lastName 
                })
                
                // Login the professor
                setIsLoading(true)
                stopCamera()
                
                try {
                  const result = await signInWithId(data.professor.id)
                  if (result.error) {
                    setError(result.error.message)
                    setMatchStatus('not-found')
                    isMatchingRef.current = false
                  } else {
                    // Wait for auth state to settle and camera to fully stop
                    await new Promise(resolve => setTimeout(resolve, 800))
                    // Use replace to prevent back navigation issues
                    router.replace('/professor')
                  }
                } catch (err) {
                  setError('Login failed. Please try again.')
                  setMatchStatus('not-found')
                  isMatchingRef.current = false
                } finally {
                  setIsLoading(false)
                }
              } else {
                setMatchStatus('not-found')
                isMatchingRef.current = false
                // Reset after 1.5 seconds
                setTimeout(() => {
                  setMatchStatus('idle')
                }, 1500)
              }
            } catch (err) {
              console.error('Face match error:', err)
              setMatchStatus('idle')
              isMatchingRef.current = false
            }
          }
        } else {
          setFaceDetected(false)
          if (matchStatus === 'scanning') {
            setMatchStatus('idle')
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
      setError('Face recognition server is not available. Please contact administrator.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      
      streamRef.current = stream
      setError('')
      setMatchStatus('idle')
      setMatchedProfessor(null)
      
      requestAnimationFrame(() => {
        setCameraActive(true)
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
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current)
      detectionIntervalRef.current = null
    }
    setCameraActive(false)
    setFaceDetected(false)
    setMatchStatus('idle')
    setMatchedProfessor(null)
    isMatchingRef.current = false
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-emerald-50 via-white to-emerald-50/50 p-4">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl shadow-xl border border-emerald-200/50 overflow-hidden">
          {/* Header */}
          <div className="bg-linear-to-r from-emerald-500 to-emerald-600 px-6 py-8 text-center">
            <div className="mx-auto w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4">
              <GraduationCap className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Professor Portal</h1>
            <p className="text-emerald-100">Sign in with facial recognition</p>
          </div>

          {/* Login Area */}
          <div className="p-6">
            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {!cameraActive ? (
              <div className="space-y-4">
                {/* Face Recognition UI */}
                <div className="text-center space-y-4">
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                    <Camera className="w-4 h-4" />
                    <span>Use your face to sign in securely</span>
                  </div>
                  
                  {!serverHealthy && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Face recognition server is unavailable</span>
                    </div>
                  )}

                  <button
                    onClick={startCamera}
                    disabled={!modelsLoaded || !serverHealthy}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {!modelsLoaded ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Loading face detection models...</span>
                      </>
                    ) : (
                      <>
                        <Camera className="w-5 h-5" />
                        <span>Start Face Recognition</span>
                      </>
                    )}
                  </button>

                  <p className="text-xs text-gray-500">
                    Position your face clearly in front of the camera
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative rounded-xl overflow-hidden bg-black shadow-lg" style={{ height: '350px' }}>
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

                  {/* Status indicator */}
                  <div className="absolute top-4 inset-x-0 flex justify-center">
                    <div className={`text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2 ${
                      matchStatus === 'matched' ? 'bg-emerald-600' :
                      matchStatus === 'not-found' ? 'bg-red-600' :
                      matchStatus === 'scanning' ? 'bg-blue-600' :
                      faceDetected ? 'bg-gray-700' : 'bg-gray-900/80'
                    }`}>
                      {matchStatus === 'matched' ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          Logging in...
                        </>
                      ) : matchStatus === 'scanning' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Verifying face...
                        </>
                      ) : matchStatus === 'not-found' ? (
                        'Face not recognized - Try again'
                      ) : faceDetected ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                          Face detected - Scanning
                        </>
                      ) : (
                        'Position your face in the camera'
                      )}
                    </div>
                  </div>

                  {/* Loading overlay */}
                  {isLoading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-center text-white">
                        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4" />
                        <p className="font-medium">Logging you in...</p>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={stopCamera}
                  className="w-full flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Stop Camera
                </button>
              </div>
            )}

            {/* Back to Home Link */}
            <div className="text-center text-sm text-gray-600 mt-6">
              <Link href="/" className="text-emerald-600 hover:text-emerald-700 hover:underline">
                ← Back to home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

