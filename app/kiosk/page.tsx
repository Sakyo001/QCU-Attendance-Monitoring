'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Camera, CheckCircle, XCircle, Clock, AlertTriangle, Loader2, Volume2, VolumeX, ArrowLeft } from 'lucide-react'
import { extractFaceNetFromVideo, checkFaceNetHealth } from '@/lib/facenet-python-api'
import { initializeFaceDetection } from '@/lib/mediapipe-face'

interface RecognizedStudent {
  id: string
  first_name: string
  last_name: string
  student_number: string
  confidence: number
  status: 'present' | 'late' | 'locked'
  timestamp: string
}

export default function AttendanceKioskPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sectionId = searchParams.get('sectionId') || ''
  const scheduleId = searchParams.get('scheduleId') || ''

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [isReady, setIsReady] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [serverHealthy, setServerHealthy] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [recentRecognitions, setRecentRecognitions] = useState<RecognizedStudent[]>([])
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'matched' | 'no-match' | 'already-marked' | 'locked'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [attendanceLocked, setAttendanceLocked] = useState(false)
  const [classInfo, setClassInfo] = useState<any>(null)
  const [totalPresent, setTotalPresent] = useState(0)
  const [totalLate, setTotalLate] = useState(0)
  const [totalStudents, setTotalStudents] = useState(0)
  const [idleSeconds, setIdleSeconds] = useState(0)
  const [soundEnabled, setSoundEnabled] = useState(true)

  const IDLE_TIMEOUT = 60 // seconds before showing idle screen

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Check server health
  useEffect(() => {
    const check = async () => {
      const healthy = await checkFaceNetHealth()
      setServerHealthy(healthy)
      if (!healthy) {
        console.warn('⚠️ FaceNet server not responding')
      }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  // Fetch class info and check lock status
  useEffect(() => {
    if (!sectionId) return
    
    const fetchClassInfo = async () => {
      try {
        const res = await fetch(`/api/attendance/class-info?sectionId=${sectionId}&scheduleId=${scheduleId}`)
        const data = await res.json()
        if (data.success) {
          setClassInfo(data.classInfo)
          setAttendanceLocked(data.locked)
          setTotalStudents(data.totalStudents || 0)
        }
      } catch (err) {
        console.error('Failed to fetch class info:', err)
      }
    }
    fetchClassInfo()
    const interval = setInterval(fetchClassInfo, 60000) // re-check every minute
    return () => clearInterval(interval)
  }, [sectionId, scheduleId])

  // Fetch today's stats
  useEffect(() => {
    if (!sectionId) return

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/attendance/today-stats?sectionId=${sectionId}`)
        const data = await res.json()
        if (data.success) {
          setTotalPresent(data.present || 0)
          setTotalLate(data.late || 0)
        }
      } catch (err) {
        console.error('Failed to fetch stats:', err)
      }
    }
    fetchStats()
    const interval = setInterval(fetchStats, 10000)
    return () => clearInterval(interval)
  }, [sectionId])

  // Idle timer
  useEffect(() => {
    const idleTimer = setInterval(() => {
      setIdleSeconds(prev => prev + 1)
    }, 1000)
    return () => clearInterval(idleTimer)
  }, [])

  // Reset idle on any recognition activity
  const resetIdle = useCallback(() => {
    setIdleSeconds(0)
  }, [])

  // Initialize camera
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        })
        
        // Check if component is still mounted and stream is valid
        if (!streamRef.current && stream.active) {
          streamRef.current = stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            const playPromise = videoRef.current.play()
            if (playPromise !== undefined) {
              playPromise.catch(err => {
                // Handle AbortError from interrupted play request
                if (err.name === 'AbortError') {
                  console.warn('⚠️ Play request was interrupted (navigating away)')
                } else {
                  console.error('Camera play error:', err)
                }
              })
            }
          }
          setIsReady(true)
        }
      } catch (err) {
        console.error('Camera error:', err)
      }
    }
    initCamera()

    return () => {
      // Stop all camera tracks when component unmounts
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop()
        })
        streamRef.current = null
      }
      // Pause video and clear source
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.srcObject = null
      }
      // Clear scanning interval
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
      }
      setIsReady(false)
    }
  }, [])

  // Continuous face scanning
  useEffect(() => {
    if (!isReady || !serverHealthy || attendanceLocked) return

    const scanFace = async () => {
      if (!videoRef.current || isScanning) return

      setIsScanning(true)
      try {
        // Extract face embedding from video
        const embedding = await extractFaceNetFromVideo(videoRef.current)
        
        if (!embedding.detected || !embedding.embedding) {
          setScanStatus('idle')
          setIsScanning(false)
          return
        }

        setScanStatus('scanning')

        // Match face against registered students in this section only
        const matchRes = await fetch('/api/attendance/match-face', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            faceDescriptor: embedding.embedding,
            sectionId: sectionId // Only match students enrolled in this section
          })
        })
        const matchData = await matchRes.json()

        if (!matchData.matched) {
          setScanStatus('no-match')
          setStatusMessage('Face not registered in this section')
          setTimeout(() => setScanStatus('idle'), 2000)
          setIsScanning(false)
          return
        }

        resetIdle()

        // Mark attendance with time-based rules
        const markRes = await fetch('/api/attendance/mark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionId,
            studentId: matchData.student.id,
            faceMatchConfidence: matchData.confidence,
            scheduleId
          })
        })
        const markData = await markRes.json()

        if (markData.alreadyMarked) {
          setScanStatus('already-marked')
          setStatusMessage(`${matchData.student.first_name} ${matchData.student.last_name} - Already recorded`)
          setTimeout(() => setScanStatus('idle'), 3000)
        } else if (markData.locked) {
          setScanStatus('locked')
          setStatusMessage('Attendance recording is locked (30+ minutes past start)')
          setTimeout(() => setScanStatus('idle'), 3000)
        } else if (markData.success) {
          const status = markData.record?.status || 'present'
          setScanStatus('matched')
          setStatusMessage(`${matchData.student.first_name} ${matchData.student.last_name} - ${status === 'late' ? 'LATE' : 'PRESENT'}`)
          
          const recognition: RecognizedStudent = {
            id: matchData.student.id,
            first_name: matchData.student.first_name,
            last_name: matchData.student.last_name,
            student_number: matchData.student.student_number,
            confidence: matchData.confidence,
            status: status,
            timestamp: new Date().toLocaleTimeString()
          }
          setRecentRecognitions(prev => [recognition, ...prev].slice(0, 20))

          if (status === 'present') {
            setTotalPresent(p => p + 1)
          } else if (status === 'late') {
            setTotalLate(p => p + 1)
          }

          // Play sound
          if (soundEnabled) {
            playSound(status === 'late' ? 'late' : 'success')
          }

          setTimeout(() => setScanStatus('idle'), 3000)
        }
      } catch (err) {
        console.error('Scan error:', err)
        setScanStatus('idle')
      }
      setIsScanning(false)
    }

    // Scan every 2 seconds
    scanIntervalRef.current = setInterval(scanFace, 2000)
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current)
    }
  }, [isReady, serverHealthy, attendanceLocked, isScanning, sectionId, scheduleId, soundEnabled, resetIdle])

  const playSound = (type: 'success' | 'late' | 'error') => {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.value = 0.3

      if (type === 'success') {
        osc.frequency.value = 800
        osc.start()
        setTimeout(() => { osc.frequency.value = 1000 }, 100)
        setTimeout(() => { osc.stop(); ctx.close() }, 200)
      } else if (type === 'late') {
        osc.frequency.value = 400
        osc.start()
        setTimeout(() => { osc.frequency.value = 300 }, 150)
        setTimeout(() => { osc.stop(); ctx.close() }, 300)
      } else {
        osc.frequency.value = 200
        osc.start()
        setTimeout(() => { osc.stop(); ctx.close() }, 300)
      }
    } catch {}
  }

  // If idle for too long, redirect to idle display
  useEffect(() => {
    if (idleSeconds >= IDLE_TIMEOUT && sectionId) {
      // Clean up camera before navigating away
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop()
        })
        streamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.srcObject = null
      }
      router.push(`/kiosk/idle?sectionId=${sectionId}&scheduleId=${scheduleId}`)
    }
  }, [idleSeconds, sectionId, scheduleId, router])

  // If no section selected, show selection
  if (!sectionId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 mx-auto text-yellow-400 mb-4" />
          <h1 className="text-2xl font-bold mb-2">No Class Selected</h1>
          <p className="text-gray-400 mb-6">This kiosk requires a class session to be configured.</p>
          <button
            onClick={() => router.push('/login')}
            className="px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  const getStatusColor = () => {
    switch (scanStatus) {
      case 'matched': return 'border-green-500 shadow-green-500/30'
      case 'no-match': return 'border-red-500 shadow-red-500/30'
      case 'already-marked': return 'border-blue-500 shadow-blue-500/30'
      case 'locked': return 'border-orange-500 shadow-orange-500/30'
      case 'scanning': return 'border-yellow-500 shadow-yellow-500/30 animate-pulse'
      default: return 'border-gray-700'
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" onClick={resetIdle}>
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900/80 backdrop-blur border-b border-gray-800">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/professor')}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors text-gray-400 hover:text-white"
            title="Go to professor dashboard"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="bg-primary/20 p-2 rounded-lg">
            <Camera className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">VeriFace Attendance Kiosk</h1>
            {classInfo && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
                  {classInfo.section_code}
                </span>
                <p className="text-sm text-gray-400">
                  {classInfo.room} &bull; {classInfo.day_of_week}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Server Status */}
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${serverHealthy ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
            <span className="text-xs text-gray-400">{serverHealthy ? 'Online' : 'Offline'}</span>
          </div>

          {/* Sound Toggle */}
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="text-gray-400 hover:text-white transition">
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          {/* Clock */}
          <div className="text-right">
            <p className="text-2xl font-mono font-bold tabular-nums">
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-xs text-gray-500">
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Left: Camera Feed */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {/* Attendance Lock Warning */}
          {attendanceLocked && (
            <div className="mb-6 px-6 py-3 bg-orange-500/20 border border-orange-500/50 rounded-xl flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
              <span className="text-orange-300 font-medium">Attendance recording is locked (30+ minutes past class start)</span>
            </div>
          )}

          {/* Camera with Status Border */}
          <div className={`relative rounded-3xl overflow-hidden border-4 shadow-2xl transition-all duration-500 ${getStatusColor()}`}>
            <video
              ref={videoRef}
              className="w-140 h-105 object-cover mirror"
              autoPlay
              playsInline
              muted
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            
            {/* Scan overlay */}
            {scanStatus === 'scanning' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-10 h-10 animate-spin text-yellow-400" />
                  <span className="text-sm font-medium text-yellow-300">Scanning...</span>
                </div>
              </div>
            )}

            {/* Match overlay */}
            {scanStatus === 'matched' && (
              <div className="absolute inset-0 flex items-center justify-center bg-green-600/30">
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle className="w-16 h-16 text-green-400" />
                  <span className="text-lg font-bold text-green-300">RECOGNIZED</span>
                </div>
              </div>
            )}

            {/* No match overlay */}
            {scanStatus === 'no-match' && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-600/20">
                <div className="flex flex-col items-center gap-2">
                  <XCircle className="w-16 h-16 text-red-400" />
                  <span className="text-lg font-bold text-red-300">NOT RECOGNIZED</span>
                </div>
              </div>
            )}
          </div>

          {/* Status Message */}
          <div className="mt-6 h-12 flex items-center justify-center">
            {statusMessage && (
              <p className={`text-xl font-semibold animate-in fade-in slide-in-from-bottom-2 ${
                scanStatus === 'matched' ? 'text-green-400' :
                scanStatus === 'no-match' ? 'text-red-400' :
                scanStatus === 'already-marked' ? 'text-blue-400' :
                scanStatus === 'locked' ? 'text-orange-400' :
                'text-gray-400'
              }`}>
                {statusMessage}
              </p>
            )}
            {scanStatus === 'idle' && !statusMessage && !attendanceLocked && (
              <p className="text-gray-500 text-lg">Step in front of the camera to mark attendance</p>
            )}
          </div>

          {/* Class Time Info */}
          {classInfo && (
            <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {classInfo.start_time} - {classInfo.end_time}
              </span>
              <span>|</span>
              <span>Late after 20 min from start</span>
            </div>
          )}
        </div>

        {/* Right: Stats & Recent Activity */}
        <div className="w-96 border-l border-gray-800 bg-gray-900/50 flex flex-col">
          {/* Stats */}
          <div className="p-6 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Today&apos;s Attendance</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-green-500/10 rounded-xl p-4 text-center border border-green-500/20">
                <p className="text-3xl font-bold text-green-400">{totalPresent}</p>
                <p className="text-xs text-green-300/70 mt-1">Present</p>
              </div>
              <div className="bg-yellow-500/10 rounded-xl p-4 text-center border border-yellow-500/20">
                <p className="text-3xl font-bold text-yellow-400">{totalLate}</p>
                <p className="text-xs text-yellow-300/70 mt-1">Late</p>
              </div>
              <div className="bg-red-500/10 rounded-xl p-4 text-center border border-red-500/20">
                <p className="text-3xl font-bold text-red-400">{Math.max(0, totalStudents - totalPresent - totalLate)}</p>
                <p className="text-xs text-red-300/70 mt-1">Absent</p>
              </div>
            </div>
          </div>

          {/* Recent Recognitions */}
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Recent Activity</h2>
            {recentRecognitions.length === 0 ? (
              <div className="text-center py-12 text-gray-600">
                <Camera className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No students scanned yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentRecognitions.map((rec, idx) => (
                  <div
                    key={`${rec.id}-${idx}`}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      idx === 0 ? 'animate-in fade-in slide-in-from-top-2' : ''
                    } ${
                      rec.status === 'present'
                        ? 'bg-green-500/5 border-green-500/20'
                        : rec.status === 'late'
                        ? 'bg-yellow-500/5 border-yellow-500/20'
                        : 'bg-red-500/5 border-red-500/20'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                      rec.status === 'present' ? 'bg-green-500/20 text-green-400' :
                      rec.status === 'late' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {rec.first_name[0]}{rec.last_name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {rec.first_name} {rec.last_name}
                      </p>
                      <p className="text-xs text-gray-500">{rec.student_number}</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                        rec.status === 'present'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {rec.status === 'present' ? 'PRESENT' : 'LATE'}
                      </span>
                      <p className="text-xs text-gray-600 mt-1">{rec.timestamp}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
