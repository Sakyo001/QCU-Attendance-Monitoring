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
  const extractInFlightRef = useRef<boolean>(false)
  const loginRequestTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const cameraReadyAtRef = useRef<number>(0)
  const stableFaceFramesRef = useRef<number>(0)

  const FACE_EXTRACT_INTERVAL_MS = 380
  const CAMERA_WARMUP_MS = 900
  const REQUIRED_STABLE_FRAMES = 2
  const LOGIN_TIMEOUT_MS = 2200

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
      if (videoRef.current.readyState !== 4 || videoRef.current.videoWidth === 0) return
      if (extractInFlightRef.current) return

      try {
        const mediapipeResult = await detectFaceInVideo(videoRef.current!)

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

          stableFaceFramesRef.current += 1
        } else {
          stableFaceFramesRef.current = 0
          setFaceDetected(false)
          if (matchStatus === 'scanning') setMatchStatus('idle')
          setBoundingBox(null)
          return
        }

        const now = Date.now()
        if (now < cameraReadyAtRef.current || stableFaceFramesRef.current < REQUIRED_STABLE_FRAMES) {
          return
        }

        extractInFlightRef.current = true
        const pythonResult = await extractFaceNetFromVideo(videoRef.current!, {
          quality: 0.72,
          maxDimension: 640,
        })

        if (pythonResult.detected && pythonResult.embedding) {
          setFaceDetected(true)
          
          // Prevent concurrent requests and stop if already matched or loading
          if (!isMatchingRef.current && matchStatus !== 'matched' && !isLoading) {
            isMatchingRef.current = true
            setMatchStatus('scanning')
            
            try {
              const controller = new AbortController()
              if (loginRequestTimeoutRef.current) clearTimeout(loginRequestTimeoutRef.current)
              loginRequestTimeoutRef.current = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS)

              const response = await fetch('/api/professor/face-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faceDescriptor: pythonResult.embedding }),
                signal: controller.signal,
              })
              if (loginRequestTimeoutRef.current) {
                clearTimeout(loginRequestTimeoutRef.current)
                loginRequestTimeoutRef.current = null
              }
              
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
                    // Check if error contains "fetch failed" or "Database error" - indicates offline
                    if (result.error.message?.includes('fetch failed') || result.error.message?.includes('Database error')) {
                      console.warn('⚠️ Network unavailable - using offline mode')
                      // Proceed with offline login - user data is available from face match response
                      await new Promise(resolve => setTimeout(resolve, 500))
                      router.replace('/professor')
                    } else {
                      setError(result.error.message)
                      setMatchStatus('not-found')
                      isMatchingRef.current = false
                    }
                  } else {
                    // Wait for auth state to settle and camera to fully stop
                    await new Promise(resolve => setTimeout(resolve, 800))
                    // Use replace to prevent back navigation issues
                    router.replace('/professor')
                  }
                } catch (err: any) {
                  console.error('Sign-in error:', err)
                  // Check if it's a network error
                  if (err?.message?.includes('fetch') || err?.message === 'TypeError: fetch failed') {
                    console.warn('⚠️ Network error during sign-in - attempting offline mode')
                    // Still navigate - user was recognized offline
                    await new Promise(resolve => setTimeout(resolve, 500))
                    router.replace('/professor')
                  } else {
                    setError('Login failed. Please try again.')
                    setMatchStatus('not-found')
                    isMatchingRef.current = false
                  }
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
              if (err instanceof DOMException && err.name === 'AbortError') {
                setError('Slow connection detected. Retrying facial verification...')
              } else {
                setError('Network error: Please check your connection')
              }
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
      } finally {
        extractInFlightRef.current = false
      }
    }, FACE_EXTRACT_INTERVAL_MS)
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
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
        audio: false
      })
      
      streamRef.current = stream
      setError('')
      setMatchStatus('idle')
      setMatchedProfessor(null)
      stableFaceFramesRef.current = 0
      cameraReadyAtRef.current = Date.now() + CAMERA_WARMUP_MS
      extractInFlightRef.current = false
      
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
    if (loginRequestTimeoutRef.current) {
      clearTimeout(loginRequestTimeoutRef.current)
      loginRequestTimeoutRef.current = null
    }
    setCameraActive(false)
    setFaceDetected(false)
    setMatchStatus('idle')
    setMatchedProfessor(null)
    isMatchingRef.current = false
    extractInFlightRef.current = false
    stableFaceFramesRef.current = 0
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 sm:p-8">
      <div className="w-full max-w-5xl">
        <div className="bg-white rounded-[2rem] shadow-2xl overflow-hidden flex flex-col lg:flex-row border border-slate-100">
          
          {/* Left Panel - Info & Controls */}
          <div className="w-full lg:w-5/12 bg-linear-to-br from-emerald-600 to-teal-800 p-8 lg:p-12 flex flex-col items-center lg:items-start text-center lg:text-left relative overflow-hidden">
            {/* Decor */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white/10 blur-3xl"></div>
            <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 rounded-full bg-black/10 blur-2xl"></div>

            <div className="relative z-10 w-full flex-1 flex flex-col">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-8 shadow-inner border border-white/20 lg:mx-0 mx-auto">
                <GraduationCap className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-4xl font-bold text-white mb-4 tracking-tight">Professor Portal</h1>
              <p className="text-emerald-50 text-lg mb-12 font-light">Secure, fast, and seamless access using facial recognition.</p>
              
              <div className="mt-auto pt-8 border-t border-white/20 w-full space-y-6">
                 <div className="flex items-center gap-3 text-emerald-50/90 mb-4 justify-center lg:justify-start">
                   <div className={`w-2 h-2 rounded-full animate-pulse ${cameraActive ? 'bg-emerald-400' : 'bg-amber-400'}`}></div>
                   <span className="text-sm font-semibold uppercase tracking-wider">{cameraActive ? 'System Active' : 'System Standby'}</span>
                 </div>
                 
                 <div className="space-y-4">
                   <div className="flex items-center gap-4 text-white">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                        <span className="font-semibold text-sm">1</span>
                      </div>
                      <p className="text-sm text-emerald-50 font-medium">Position your face clearly in frame</p>
                   </div>
                   <div className="flex items-center gap-4 text-white">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                        <span className="font-semibold text-sm">2</span>
                      </div>
                      <p className="text-sm text-emerald-50 font-medium">Wait for biometric verification</p>
                   </div>
                   <div className="flex items-center gap-4 text-white">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                        <span className="font-semibold text-sm">3</span>
                      </div>
                      <p className="text-sm text-emerald-50 font-medium">Automatic secure login</p>
                   </div>
                 </div>

                 <div className="pt-8">
                   <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-50/70 hover:text-white transition-colors group">
                     <span className="group-hover:-translate-x-1 transition-transform">←</span> Return to Main Menu
                   </Link>
                 </div>
              </div>
            </div>
          </div>

          {/* Right Panel - Camera UI */}
          <div className="w-full lg:w-7/12 p-8 lg:p-12 bg-white flex flex-col justify-center relative min-h-[500px]">
            {error && (
              <div className="flex items-center gap-3 p-4 mb-6 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 shadow-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span className="font-medium">{error}</span>
              </div>
            )}

            {!serverHealthy && !error && (
              <div className="flex items-center gap-3 p-4 mb-6 bg-amber-50 border border-amber-100 rounded-2xl text-sm text-amber-700 shadow-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span className="font-medium">Face recognition server is unavailable</span>
              </div>
            )}

            <div className={`w-full aspect-[4/3] max-h-[600px] relative rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 border-4 bg-slate-900 ${
              cameraActive ? (
                matchStatus === 'matched' ? 'border-emerald-500 shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)]' :
                matchStatus === 'not-found' ? 'border-red-500 shadow-[0_0_40px_-10px_rgba(239,68,68,0.5)]' : 'border-slate-800'
              ) : 'border-slate-100'
            }`}>
              {!cameraActive ? (
                 <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-slate-900 border border-slate-800">
                    <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center mb-6 shadow-inner border border-slate-700">
                       <Scan className="w-10 h-10 text-emerald-400" />
                    </div>
                    <div className="mb-8">
                      <h3 className="text-2xl font-bold text-white mb-3">Scanner Inactive</h3>
                      <p className="text-slate-400 text-sm max-w-sm mx-auto leading-relaxed">
                        Activate your camera to start the secure facial recognition process. Ensure you are in a well-lit area.
                      </p>
                    </div>
                    <button
                      onClick={startCamera}
                      disabled={!modelsLoaded || !serverHealthy}
                      className="group relative w-full sm:w-auto overflow-hidden bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-4 px-10 rounded-full transition-all flex items-center justify-center gap-3 shadow-[0_0_40px_-10px_rgba(16,185,129,0.4)] hover:shadow-[0_0_60px_-15px_rgba(16,185,129,0.6)] active:scale-95"
                    >
                      {!modelsLoaded ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Initializing Systems...</span>
                        </>
                      ) : (
                        <>
                          <Camera className="w-5 h-5" />
                          <span>Initialize Scanner</span>
                        </>
                      )}
                    </button>
                 </div>
              ) : (
                 <>
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

                  {/* Smart Status Overlay */}
                  <div className="absolute top-6 inset-x-0 flex justify-center z-10 px-4">
                    <div className={`text-white text-sm font-semibold px-6 py-3 rounded-full backdrop-blur-xl border flex items-center gap-3 shadow-xl transition-all duration-300 ${
                      matchStatus === 'matched' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-50' :
                      matchStatus === 'not-found' ? 'bg-red-500/20 border-red-500/50 text-red-50' :
                      matchStatus === 'scanning' ? 'bg-blue-500/20 border-blue-500/50 text-blue-50' :
                      faceDetected ? 'bg-slate-800/60 border-slate-500/40 text-white' : 'bg-slate-900/80 border-slate-700/60 text-slate-300'
                    }`}>
                        {matchStatus === 'matched' ? (
                        <>
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          Authentication Successful
                        </>
                      ) : matchStatus === 'scanning' ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                          Analyzing Biometrics...
                        </>
                      ) : matchStatus === 'not-found' ? (
                        'Identity Unverified - Try Again'
                      ) : faceDetected ? (
                        <>
                          <span className="flex h-3 w-3 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                          </span>
                          Target Acquired
                        </>
                      ) : (
                        'Awaiting Subject...'
                      )}
                    </div>
                  </div>

                  {/* Cinematic Loading Overlay */}
                  {isLoading && (
                    <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-20 transition-opacity duration-300">
                      <div className="text-center p-8 bg-slate-800/50 rounded-3xl border border-slate-700/50 shadow-2xl flex flex-col items-center">
                        <Loader2 className="w-16 h-16 animate-spin text-emerald-400 mb-6" />
                        <h3 className="text-2xl font-bold text-white mb-2">Authenticating</h3>
                        <p className="text-slate-300 font-medium">Establishing secure session...</p>
                      </div>
                    </div>
                  )}
                 </>
              )}
            </div>

            {/* Bottom Controls */}
            {cameraActive && (
              <div className="mt-8 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button
                  onClick={stopCamera}
                  className="flex items-center justify-center gap-2 bg-white border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 font-bold py-3.5 px-8 rounded-full transition-all shadow-sm hover:shadow-md active:scale-95"
                >
                  <RefreshCw className="w-5 h-5" />
                  Terminate Session
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

