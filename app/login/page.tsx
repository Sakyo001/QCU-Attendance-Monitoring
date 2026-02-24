'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LogIn, Mail, Lock, AlertCircle, Loader2, Camera, CheckCircle2, RefreshCw, Scan } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { initializeFaceDetection, detectFaceInVideo } from '@/lib/mediapipe-face'
import { extractFaceNetFromVideo, checkFaceNetHealth, waitForModelReady } from '@/lib/facenet-python-api'

export default function UnifiedLoginPage() {
  const router = useRouter()
  const { signIn, signInWithId } = useAuth()
  
  const [loginMethod, setLoginMethod] = useState<'email' | 'face'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [serverHealthy, setServerHealthy] = useState(true)
  const [cameraActive, setCameraActive] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [matchStatus, setMatchStatus] = useState<'idle' | 'scanning' | 'matched' | 'not-found'>('idle')
  const [matchedUser, setMatchedUser] = useState<{ firstName: string; lastName: string } | null>(null)
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastMatchTimeRef = useRef<number>(0)

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

  // Setup video and canvas when camera activates
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.onloadedmetadata = () => {
        if (videoRef.current && canvasRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth
          canvasRef.current.height = videoRef.current.videoHeight
          startFaceDetection()
        }
      }
    }
  }, [cameraActive])

  // Draw bounding box
  useEffect(() => {
    if (canvasRef.current && boundingBox) {
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const color = 
        matchStatus === 'matched' ? '#10b981' :
        matchStatus === 'not-found' ? '#ef4444' :
        matchStatus === 'scanning' ? '#3b82f6' :
        faceDetected ? '#6b7280' : '#9ca3af'

      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.setLineDash([10, 5])

      const { x, y, width, height } = boundingBox
      ctx.strokeRect(x, y, width, height)

      // Corner markers
      const cornerLength = 20
      ctx.setLineDash([])
      ctx.lineWidth = 4

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

      // Status label
      const statusText = 
        matchStatus === 'matched' ? 'Matched! Logging in...' :
        matchStatus === 'scanning' ? 'Verifying...' :
        matchStatus === 'not-found' ? 'Not Recognized' :
        faceDetected ? 'Face Detected' : 'No Face'

      ctx.save()
      ctx.scale(-1, 1)
      ctx.fillStyle = color
      ctx.fillRect(-x - width / 2 - 70, y - 35, 140, 28)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(statusText, -x - width / 2, y - 15)
      ctx.restore()
    } else if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      }
    }
  }, [boundingBox, faceDetected, matchStatus])

  const startFaceDetection = () => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current)
    }

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return

      const video = videoRef.current
      if (video.readyState !== 4) return

      try {
        const [mediapipeResult, pythonResult] = await Promise.all([
          detectFaceInVideo(video),
          extractFaceNetFromVideo(video)
        ])

        // Bounding box from MediaPipe
        if (mediapipeResult.detected && mediapipeResult.boundingBox) {
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

        // Face matching
        if (pythonResult.detected && pythonResult.embedding) {
          setFaceDetected(true)
          
          // Throttle face matching to every 1.5 seconds
          const now = Date.now()
          if (now - lastMatchTimeRef.current >= 1500 && matchStatus !== 'matched') {
            lastMatchTimeRef.current = now
            setMatchStatus('scanning')
            
            try {
              const response = await fetch('/api/auth/face-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faceDescriptor: pythonResult.embedding })
              })
              
              const data = await response.json()
              
              if (data.matched && data.user) {
                setMatchStatus('matched')
                setMatchedUser({ 
                  firstName: data.user.firstName, 
                  lastName: data.user.lastName 
                })
                
                // Login the user
                setIsLoading(true)
                
                try {
                  const result = await signInWithId(data.user.id)
                  
                  if (result.error) {
                    setError(`Authentication failed: ${result.error.message}`)
                    setMatchStatus('not-found')
                    setIsLoading(false)
                    return
                  }

                  if (result.user) {
                    // Success! Redirect based on role
                    const dashboardPath = 
                      data.user.role === 'admin' ? '/admin' :
                      data.user.role === 'professor' ? '/professor' :
                      data.user.role === 'student' ? '/student' :
                      '/'
                    
                    // Stop camera before redirect
                    stopCamera()
                    
                    // Small delay to ensure state is updated and camera is stopped
                    await new Promise(resolve => setTimeout(resolve, 800))
                    
                    // Use replace instead of push to prevent back navigation issues
                    router.replace(dashboardPath)
                  } else {
                    setError('Login succeeded but user data is missing')
                    setMatchStatus('not-found')
                    setIsLoading(false)
                  }
                } catch (err) {
                  console.error('Login exception:', err)
                  setError('Login failed. Please try again.')
                  setMatchStatus('not-found')
                } finally {
                  setIsLoading(false)
                }
              } else {
                setMatchStatus('not-found')
                // Reset after 2 seconds
                setTimeout(() => {
                  if (matchStatus !== 'matched') {
                    setMatchStatus('idle')
                  }
                }, 2000)
              }
            } catch (err) {
              console.error('Face match error:', err)
              setMatchStatus('idle')
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
      setMatchedUser(null)
      
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
    setMatchedUser(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      console.log('Attempting unified login with:', email)
      const { user, error } = await signIn({ email, password })

      if (error) {
        console.error('Login error:', error)
        setError(error.message)
        setIsLoading(false)
        return
      }

      if (!user) {
        console.error('No user returned from signIn')
        setError('Login failed. Please try again.')
        setIsLoading(false)
        return
      }

      console.log('Login successful for role:', user.role)
      
      // Redirect based on detected role
      // Students no longer have a separate portal - they use the kiosk for attendance
      // and request attendance summary from their professor
      const dashboardPath = 
        user.role === 'admin' ? '/admin' :
        user.role === 'professor' ? '/professor' :
        user.role === 'student' ? '/student' :
        '/';

      console.log('Redirecting to:', dashboardPath)
      router.push(dashboardPath)
      
    } catch (err) {
      console.error('Unexpected error:', err)
      setError('An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-primary/5 via-background to-violet-50/30 dark:from-primary/10 dark:via-background dark:to-violet-950/20 p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-2xl border border-border/50 overflow-hidden backdrop-blur-sm">
          {/* Header */}
          <div className="bg-linear-to-r from-primary via-violet-500 to-blue-500 px-6 py-10 text-center relative overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-0 left-0 w-full h-full opacity-10">
              <div className="absolute top-4 left-4 w-20 h-20 border-2 border-white rounded-full" />
              <div className="absolute bottom-4 right-4 w-16 h-16 border-2 border-white rounded-full" />
            </div>
            
            <div className="relative z-10">
              <div className="mx-auto w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-lg">
                <LogIn className="w-10 h-10 text-primary" />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
              <p className="text-white/90 text-sm">Sign in to access your dashboard</p>
            </div>
          </div>

          {/* Login Method Tabs */}
          <div className="flex border-b border-border/50">
            <button
              onClick={() => {
                setLoginMethod('email')
                stopCamera()
                setError('')
              }}
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                loginMethod === 'email'
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <Mail className="w-4 h-4" />
              Email & Password
            </button>
            <button
              onClick={() => {
                setLoginMethod('face')
                setError('')
              }}
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                loginMethod === 'face'
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <Scan className="w-4 h-4" />
              Face Recognition
            </button>
          </div>

          {/* Form */}
          <div className="p-8 space-y-5">
            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive animate-in fade-in slide-in-from-top-2 duration-300">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {loginMethod === 'email' ? (
              <form onSubmit={handleSubmit} className="space-y-5">'

            {/* Email Field */}
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-semibold text-foreground block">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  placeholder="your.email@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border border-input bg-background rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all placeholder:text-muted-foreground/60"
                  required
                  autoComplete="email"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-semibold text-foreground block">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border border-input bg-background rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all placeholder:text-muted-foreground/60"
                  required
                  autoComplete="current-password"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Forgot Password Link */}
            <div className="flex justify-end">
              <Link 
                href="/forgot-password" 
                className="text-sm text-primary hover:text-primary/80 hover:underline font-medium transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-primary-foreground font-semibold py-3 px-4 rounded-lg transition-all duration-200 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </form>
        ) : !cameraActive ? (
          <div className="space-y-4">
            {/* Face Recognition Start UI */}
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
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
                className="w-full bg-primary hover:bg-primary/90 disabled:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground text-primary-foreground font-semibold py-3 px-4 rounded-lg transition-all duration-200 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
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

              <p className="text-xs text-muted-foreground">
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
              className="w-full flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-foreground font-medium py-2 px-4 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Stop Camera
            </button>
          </div>
        )}

            {/* Back to Home Link */}
            <div className="text-center pt-2">
              <Link 
                href="/" 
                className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 group"
              >
                <span className="group-hover:-translate-x-1 transition-transform">←</span>
                <span>Back to home</span>
              </Link>
            </div>
          </div>

          {/* Footer Info */}
          <div className="bg-muted/50 px-8 py-5 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground mb-2 font-medium">
              Your role will be automatically detected
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Admin</span>
              <span className="text-muted-foreground/40">•</span>
              <span className="w-2 h-2 rounded-full bg-violet-500"></span>
              <span>Faculty</span>
              <span className="text-muted-foreground/40">•</span>
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span>Student</span>
            </div>
          </div>
        </div>

        {/* Security Badge */}
        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
            <Lock className="w-3 h-3" />
            <span>Secured with end-to-end encryption</span>
          </p>
        </div>
      </div>
    </div>
  )
}
