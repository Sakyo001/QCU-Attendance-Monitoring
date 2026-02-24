'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { CheckCircle, XCircle, Clock, AlertTriangle, Loader2, Volume2, VolumeX, Users, Lock, Scan, ShieldCheck, ArrowLeft, ChevronRight, MapPin, Timer } from 'lucide-react'
import { extractFaceNetFromVideo, checkFaceNetHealth, waitForModelReady, loadSessionEncodings, clearSessionEncodings, RealtimeRecognizer } from '@/lib/facenet-python-api'
import type { DetectedFace, RecognizedFace, RecognitionResult } from '@/lib/facenet-python-api'
import { initializeFaceDetection, detectFaceInVideo } from '@/lib/mediapipe-face'

// ============ Types ============

interface ProfessorInfo {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  employeeId: string
}

interface ScheduleInfo {
  id: string
  sectionId: string
  sectionCode: string
  room: string
  dayOfWeek: string
  startTime: string
  endTime: string
  totalStudents: number
  semester?: string
  academicYear?: string
}

interface EnrolledStudent {
  id: string
  studentNumber: string
  firstName: string
  lastName: string
  status: 'present' | 'late' | 'absent' | 'pending'
  checkedInAt: string | null
  confidence: number | null
}

type KioskPhase = 'professor-scan' | 'schedule-select' | 'attendance-active' | 'attendance-locked'

// ============ Component ============

export default function Home() {
  const router = useRouter()
  
  // --- Phase state ---
  const [phase, setPhase] = useState<KioskPhase>('professor-scan')

  // --- Professor scan state ---
  const [professor, setProfessor] = useState<ProfessorInfo | null>(null)
  const [schedules, setSchedules] = useState<ScheduleInfo[]>([])
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleInfo | null>(null)

  // --- Camera & detection ---
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastMediaPipeCallRef = useRef<number>(0)
  const lastFaceNetCallRef = useRef<number>(0)
  const isDetectingRef = useRef<boolean>(false)
  const isMatchingRef = useRef<boolean>(false)
  const hasMarkedAbsentRef = useRef<boolean>(false)
  const scanCooldownUntilRef = useRef<number>(0)

  // --- General state ---
  const [serverHealthy, setServerHealthy] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [soundEnabled, setSoundEnabled] = useState(true)

  // --- Professor scan UI ---
  const [professorScanStatus, setProfessorScanStatus] = useState<'idle' | 'scanning' | 'matched' | 'not-found'>('idle')
  const [faceDetected, setFaceDetected] = useState(false)
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  // --- Attendance state ---
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'matched' | 'no-match' | 'already-marked' | 'locked'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([])
  const [stats, setStats] = useState({ present: 0, late: 0, absent: 0, pending: 0, total: 0 })
  const [attendanceLocked, setAttendanceLocked] = useState(false)
  const [lockTimeRemaining, setLockTimeRemaining] = useState('')

  // --- Multi-face state ---
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([])
  const [faceMatchResults, setFaceMatchResults] = useState<Array<{ box: DetectedFace['box']; name: string; status: 'matched' | 'no-match' | 'already-marked' }>>([])
  const attendanceCanvasRef = useRef<HTMLCanvasElement>(null)
  const recognizerRef = useRef<RealtimeRecognizer | null>(null)
  const markedStudentIdsRef = useRef<Set<string>>(new Set())
  const markingStudentIdsRef = useRef<Set<string>>(new Set())

  // ============ Effects ============

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Check server health + load models
  useEffect(() => {
    const init = async () => {
      const [healthy, loaded] = await Promise.all([
        checkFaceNetHealth(),
        initializeFaceDetection()
      ])
      setServerHealthy(healthy)
      setModelsLoaded(loaded)
      if (healthy) {
        // Wait for model to finish loading in background (non-blocking for UI)
        waitForModelReady().then(ready => {
          if (!ready) console.warn('⚠️ Model did not become ready within timeout')
        })
      }
    }
    init()
    const interval = setInterval(async () => {
      const healthy = await checkFaceNetHealth()
      setServerHealthy(healthy)
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  // Initialize camera on mount
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      } catch (err) {
        console.error('Camera error:', err)
      }
    }
    initCamera()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current)
    }
  }, [])

  // Ensure video element always has the stream attached (handles phase transitions)
  useEffect(() => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [phase])

  // ============ Phase 1: Professor Face Scan ============

  useEffect(() => {
    if (phase !== 'professor-scan' || !serverHealthy || !modelsLoaded) return

    const MEDIAPIPE_THROTTLE_MS = 150  // ~6-7 fps — safe for MediaPipe WASM
    const FACENET_THROTTLE_MS = 600    // fast enough for professor detection

    const loop = async () => {
      const video = videoRef.current
      if (!video) { rafRef.current = requestAnimationFrame(loop); return }

      const now = Date.now()

      // Respect cooldown after session reset (prevents instant re-login)
      if (now < scanCooldownUntilRef.current) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }

      // --- MediaPipe: throttled bounding box ---
      if (
        !isDetectingRef.current &&
        now - lastMediaPipeCallRef.current >= MEDIAPIPE_THROTTLE_MS &&
        video.readyState === 4 &&
        video.videoWidth > 0
      ) {
        lastMediaPipeCallRef.current = now
        isDetectingRef.current = true
        try {
          const mediapipeResult = await detectFaceInVideo(video)
          if (mediapipeResult.detected && mediapipeResult.boundingBox && videoRef.current) {
            const v = videoRef.current
            const { xCenter, yCenter, width, height } = mediapipeResult.boundingBox
            const cx = xCenter * v.videoWidth
            const cy = yCenter * v.videoHeight
            const pw = width * v.videoWidth
            const ph = height * v.videoHeight
            const pad = 40
            const side = Math.max(pw, ph) + pad * 2
            setBoundingBox({
              x: Math.max(0, cx - side / 2),
              y: Math.max(0, cy - side / 2),
              width: Math.min(v.videoWidth, side),
              height: Math.min(v.videoHeight, side),
            })
            setFaceDetected(true)
          } else {
            setBoundingBox(null)
            setFaceDetected(false)
          }
        } catch (err) {
          console.warn('MediaPipe detection error (ignored):', err)
        } finally {
          isDetectingRef.current = false
        }
      }

      // --- FaceNet: throttled, only when video is ready ---
      if (
        !isMatchingRef.current &&
        now - lastFaceNetCallRef.current >= FACENET_THROTTLE_MS &&
        video.readyState === 4 &&
        video.videoWidth > 0
      ) {
        lastFaceNetCallRef.current = now
        try {
          const pythonResult = await extractFaceNetFromVideo(video)

          if (pythonResult.detected && pythonResult.embedding) {
            setFaceDetected(true)
            isMatchingRef.current = true
            setProfessorScanStatus('scanning')

            try {
              const res = await fetch('/api/professor/face-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faceDescriptor: pythonResult.embedding })
              })
              const data = await res.json()

              if (data.matched && data.professor) {
                setProfessorScanStatus('matched')
                const prof: ProfessorInfo = {
                  id: data.professor.id,
                  firstName: data.professor.firstName,
                  lastName: data.professor.lastName,
                  email: data.professor.email,
                  role: data.professor.role,
                  employeeId: data.professor.employeeId
                }
                setProfessor(prof)
                playSound('success')

                const schedRes = await fetch(`/api/kiosk/professor-schedule?professorId=${prof.id}`)
                const schedData = await schedRes.json()

                if (schedData.success && schedData.schedules.length > 0) {
                  setSchedules(schedData.schedules)
                  if (schedData.schedules.length === 1) {
                    selectSchedule(schedData.schedules[0])
                  } else {
                    setPhase('schedule-select')
                  }
                } else {
                  setStatusMessage('No classes scheduled for today')
                  setTimeout(() => { resetToScan() }, 3000)
                }
              } else {
                setProfessorScanStatus('not-found')
                isMatchingRef.current = false
                setTimeout(() => setProfessorScanStatus('idle'), 1500)
              }
            } catch (err) {
              console.error('Professor match error:', err)
              setProfessorScanStatus('idle')
              isMatchingRef.current = false
            }
          } else {
            if (professorScanStatus === 'scanning') setProfessorScanStatus('idle')
          }
        } catch { /* ignore — server may still be warming up */ }
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [phase, serverHealthy, modelsLoaded])

  // ============ Phase 2: Schedule Select ============

  const selectSchedule = useCallback(async (schedule: ScheduleInfo) => {
    setSelectedSchedule(schedule)
    hasMarkedAbsentRef.current = false
    isMatchingRef.current = false
    markedStudentIdsRef.current = new Set()
    markingStudentIdsRef.current = new Set()

    // Load enrolled face encodings into Python server session cache
    try {
      const res = await fetch(`/api/attendance/section-encodings?sectionId=${schedule.sectionId}`)
      const data = await res.json()
      if (data.success && data.students?.length > 0) {
        await loadSessionEncodings(schedule.sectionId, data.students)
        console.log(`\u{1F4DA} Session loaded: ${data.students.length} students`)
      }
    } catch (err) {
      console.error('Failed to load session encodings:', err)
    }

    setPhase('attendance-active')
  }, [])

  // ============ Phase 3: Attendance Scanning ============

  // Fetch enrolled students periodically
  useEffect(() => {
    if ((phase !== 'attendance-active' && phase !== 'attendance-locked') || !selectedSchedule) return

    const controller = new AbortController()

    const fetchStudents = async () => {
      try {
        const res = await fetch(
          `/api/attendance/enrolled-students?sectionId=${selectedSchedule.sectionId}`,
          { signal: controller.signal }
        )
        const data = await res.json()
        if (data.success) {
          setEnrolledStudents(data.students)
          setStats(data.stats)
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Failed to fetch students:', err)
        }
      }
    }

    // When locked: fetch once to show final state, then stop
    fetchStudents()
    if (phase === 'attendance-locked') {
      return () => controller.abort()
    }

    const interval = setInterval(fetchStudents, 5000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [phase, selectedSchedule])

  // Check lock time countdown
  useEffect(() => {
    if (phase !== 'attendance-active' || !selectedSchedule) return

    const checkLock = () => {
      const now = new Date()
      const [hours, minutes] = selectedSchedule.startTime.split(':').map(Number)
      const classStart = new Date(now)
      classStart.setHours(hours, minutes, 0, 0)

      const lockTime = new Date(classStart.getTime() + 30 * 60 * 1000)
      const diffMs = lockTime.getTime() - now.getTime()

      if (diffMs <= 0) {
        // Lock attendance
        setAttendanceLocked(true)
        setPhase('attendance-locked')
        setLockTimeRemaining('00:00')
        // Clear any active scan overlays immediately
        setFaceMatchResults([])
        setDetectedFaces([])
        setScanStatus('locked')

        // Auto-mark remaining students as absent
        if (!hasMarkedAbsentRef.current) {
          hasMarkedAbsentRef.current = true
          markRemainingAbsent()
        }
      } else {
        const mins = Math.floor(diffMs / 60000)
        const secs = Math.floor((diffMs % 60000) / 1000)
        setLockTimeRemaining(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`)
      }
    }

    checkLock()
    const interval = setInterval(checkLock, 1000)
    return () => clearInterval(interval)
  }, [phase, selectedSchedule])

  // Multi-face real-time scanning via WebSocket
  useEffect(() => {
    if (phase !== 'attendance-active' || !serverHealthy || !selectedSchedule || attendanceLocked) return
    if (!videoRef.current) return

    const recognizer = new RealtimeRecognizer()
    recognizerRef.current = recognizer

    recognizer.start(videoRef.current, (result: RecognitionResult) => {
      if (!result.detected || result.faces.length === 0) {
        setDetectedFaces([])
        setFaceMatchResults([])
        setScanStatus('idle')
        return
      }

      // Update detected faces for canvas drawing
      setDetectedFaces(result.faces.map(f => ({
        index: f.index,
        embedding: [],
        embedding_size: 0,
        box: f.box
      })))

      // Build UI match results
      const uiResults: Array<{ box: DetectedFace['box']; name: string; status: 'matched' | 'no-match' | 'already-marked' }> = []

      for (const face of result.faces) {
        if (face.matched && face.studentId) {
          // Check if already marked
          if (markedStudentIdsRef.current.has(face.studentId)) {
            uiResults.push({ box: face.box, name: face.name, status: 'already-marked' })
          } else {
            uiResults.push({ box: face.box, name: face.name, status: 'matched' })

            // Mark attendance (only once per student)
            if (!markingStudentIdsRef.current.has(face.studentId)) {
              markingStudentIdsRef.current.add(face.studentId)

              fetch('/api/attendance/mark', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sectionId: selectedSchedule.sectionId,
                  studentId: face.studentId,
                  faceMatchConfidence: face.confidence,
                  scheduleId: selectedSchedule.id
                })
              }).then(async res => {
                const markData = await res.json()
                if (markData.alreadyMarked) {
                  markedStudentIdsRef.current.add(face.studentId!)
                  markingStudentIdsRef.current.delete(face.studentId!)
                } else if (markData.locked) {
                  setAttendanceLocked(true)
                  setPhase('attendance-locked')
                  markingStudentIdsRef.current.delete(face.studentId!)
                } else if (markData.success) {
                  markedStudentIdsRef.current.add(face.studentId!)
                  markingStudentIdsRef.current.delete(face.studentId!)
                  const recStatus = markData.record?.status || 'present'
                  playSound(recStatus === 'late' ? 'late' : 'success')
                  refreshStudentList()
                }
              }).catch(() => {
                markingStudentIdsRef.current.delete(face.studentId!)
              })
            }
          }
        } else {
          uiResults.push({ box: face.box, name: 'Unknown', status: 'no-match' })
        }
      }

      setFaceMatchResults(uiResults)

      // Update aggregate scan status
      const hasNewMatch = uiResults.some(r => r.status === 'matched')
      const hasNoMatch = uiResults.some(r => r.status === 'no-match')
      const allAlready = uiResults.length > 0 && uiResults.every(r => r.status === 'already-marked')

      if (allAlready) {
        setScanStatus('already-marked')
        setStatusMessage('All detected faces already recorded')
      } else if (hasNewMatch) {
        setScanStatus('matched')
        const names = uiResults.filter(r => r.status === 'matched').map(r => r.name).join(', ')
        setStatusMessage(names)
      } else if (hasNoMatch) {
        setScanStatus('no-match')
        setStatusMessage(`${result.faces.length} face(s) detected \u2014 not recognized`)
      }
    })

    return () => {
      recognizer.stop()
      recognizerRef.current = null
    }
  }, [phase, serverHealthy, selectedSchedule, attendanceLocked])

  // ============ Helpers ============

  const refreshStudentList = async () => {
    if (!selectedSchedule) return
    try {
      const res = await fetch(`/api/attendance/enrolled-students?sectionId=${selectedSchedule.sectionId}`)
      const data = await res.json()
      if (data.success) {
        setEnrolledStudents(data.students)
        setStats(data.stats)
      }
    } catch {}
  }

  const markRemainingAbsent = async () => {
    if (!selectedSchedule) return
    try {
      await fetch('/api/attendance/mark-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId: selectedSchedule.sectionId })
      })
      playSound('error')
      // Refresh the student list to show newly absent students
      setTimeout(refreshStudentList, 1000)
    } catch (err) {
      console.error('Error marking absences:', err)
    }
  }

  const resetToScan = () => {
    // Stop real-time recognizer
    if (recognizerRef.current) {
      recognizerRef.current.stop()
      recognizerRef.current = null
    }
    clearSessionEncodings()

    setProfessor(null)
    setSchedules([])
    setSelectedSchedule(null)
    setEnrolledStudents([])
    setStats({ present: 0, late: 0, absent: 0, pending: 0, total: 0 })
    setAttendanceLocked(false)
    setScanStatus('idle')
    setProfessorScanStatus('idle')
    setStatusMessage('')
    setFaceDetected(false)
    setBoundingBox(null)
    setDetectedFaces([])
    setFaceMatchResults([])
    isMatchingRef.current = false
    isDetectingRef.current = false
    lastMediaPipeCallRef.current = 0
    lastFaceNetCallRef.current = 0
    // 4-second cooldown so the professor isn't instantly re-detected after reset
    scanCooldownUntilRef.current = Date.now() + 4000
    hasMarkedAbsentRef.current = false
    markedStudentIdsRef.current = new Set()
    markingStudentIdsRef.current = new Set()
    setPhase('professor-scan')
  }

  const playSound = (type: 'success' | 'late' | 'error') => {
    if (!soundEnabled) return
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

  const formatTime = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
  }

  const getStatusColor = () => {
    switch (scanStatus) {
      case 'matched': return 'border-green-500 shadow-green-500/30'
      case 'no-match': return 'border-red-500 shadow-red-500/30'
      case 'already-marked': return 'border-blue-500 shadow-blue-500/30'
      case 'locked': return 'border-orange-500 shadow-orange-500/30'
      case 'scanning': return 'border-yellow-500 shadow-yellow-500/30 animate-pulse'
      default: return 'border-gray-300'
    }
  }

  const getProfessorBorderColor = () => {
    switch (professorScanStatus) {
      case 'matched': return 'border-green-500 shadow-green-500/30'
      case 'not-found': return 'border-red-500 shadow-red-500/30'
      case 'scanning': return 'border-yellow-500 shadow-yellow-500/30 animate-pulse'
      default: return faceDetected ? 'border-blue-500 shadow-blue-500/20' : 'border-gray-300'
    }
  }

  // ============ Canvas Drawing (Professor Phase) ============

  useEffect(() => {
    if (phase !== 'professor-scan' || !canvasRef.current || !videoRef.current) return

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
        const boxColor = professorScanStatus === 'matched' ? '#10b981' :
                         professorScanStatus === 'not-found' ? '#ef4444' :
                         faceDetected ? '#3b82f6' : '#6b7280'

        ctx.shadowColor = boxColor
        ctx.shadowBlur = 20
        ctx.strokeStyle = boxColor
        ctx.lineWidth = 4
        ctx.strokeRect(x, y, width, height)
        ctx.shadowBlur = 0

        // Corner brackets
        const cornerLength = 35
        ctx.lineWidth = 5
        ctx.lineCap = 'round'

        ctx.beginPath()
        ctx.moveTo(x, y + cornerLength); ctx.lineTo(x, y); ctx.lineTo(x + cornerLength, y)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(x + width - cornerLength, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + cornerLength)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(x, y + height - cornerLength); ctx.lineTo(x, y + height); ctx.lineTo(x + cornerLength, y + height)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(x + width - cornerLength, y + height); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width, y + height - cornerLength)
        ctx.stroke()

        // Status label
        if (professorScanStatus !== 'idle') {
          const labelText = professorScanStatus === 'matched'
            ? `\u2713 Prof. ${professor?.firstName} ${professor?.lastName}`
            : professorScanStatus === 'not-found'
              ? '\u2717 Face not recognized'
              : 'Scanning...'

          ctx.font = 'bold 16px system-ui, sans-serif'
          const textWidth = ctx.measureText(labelText).width
          const padding = 12
          const labelHeight = 32

          const bgColor = professorScanStatus === 'matched' ? 'rgba(16, 185, 129, 0.95)' :
                          professorScanStatus === 'not-found' ? 'rgba(239, 68, 68, 0.95)' :
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

      animationId = requestAnimationFrame(drawFrame)
    }

    drawFrame()
    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [phase, boundingBox, professorScanStatus, faceDetected, professor])

  // ============ Canvas Drawing (Attendance Phase — Multi-face boxes) ============

  useEffect(() => {
    if ((phase !== 'attendance-active' && phase !== 'attendance-locked') || !attendanceCanvasRef.current || !videoRef.current) return

    const canvas = attendanceCanvasRef.current
    const video = videoRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // When locked, clear the canvas once and stop — no more animated boxes
    if (phase === 'attendance-locked') {
      canvas.width = video.videoWidth || canvas.width
      canvas.height = video.videoHeight || canvas.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    let animationId: number

    const drawFrame = () => {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw boxes for match results (colored by status)
      if (faceMatchResults.length > 0) {
        for (const result of faceMatchResults) {
          const { box, name, status } = result
          const color = status === 'matched' ? '#10b981' :
                        status === 'already-marked' ? '#3b82f6' :
                        '#ef4444'

          // Canvas is CSS-flipped (scaleX -1) so draw at original coordinates
          const x = box.left
          const y = box.top
          const w = box.width
          const h = box.height

          ctx.shadowColor = color
          ctx.shadowBlur = 15
          ctx.strokeStyle = color
          ctx.lineWidth = 3
          ctx.strokeRect(x, y, w, h)
          ctx.shadowBlur = 0

          // Corner brackets
          const cl = 25
          ctx.lineWidth = 4
          ctx.lineCap = 'round'
          ctx.beginPath(); ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(x, y + h - cl); ctx.lineTo(x, y + h); ctx.lineTo(x + cl, y + h); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(x + w - cl, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cl); ctx.stroke()

          // Name label
          const labelText = status === 'matched' ? `\u2713 ${name}` :
                            status === 'already-marked' ? `\u25CF ${name}` :
                            '\u2717 Unknown'
          ctx.font = 'bold 14px system-ui, sans-serif'
          const tw = ctx.measureText(labelText).width
          const pd = 10
          const lh = 28

          const bgColor = status === 'matched' ? 'rgba(16, 185, 129, 0.9)' :
                          status === 'already-marked' ? 'rgba(59, 130, 246, 0.9)' :
                          'rgba(239, 68, 68, 0.9)'

          ctx.fillStyle = bgColor
          ctx.beginPath()
          const lx = x
          const ly = y - lh - 6
          ctx.roundRect(lx, ly, tw + pd * 2, lh, 5)
          ctx.fill()

          ctx.save()
          ctx.scale(-1, 1)
          ctx.fillStyle = 'white'
          ctx.fillText(labelText, -(lx + pd + tw), ly + 19)
          ctx.restore()
        }
      } else if (detectedFaces.length > 0 && scanStatus === 'scanning') {
        // Draw neutral boxes for detected faces while scanning
        for (const face of detectedFaces) {
          ctx.strokeStyle = '#eab308'
          ctx.lineWidth = 2
          ctx.setLineDash([8, 4])
          ctx.strokeRect(face.box.left, face.box.top, face.box.width, face.box.height)
          ctx.setLineDash([])
        }
      }

      animationId = requestAnimationFrame(drawFrame)
    }

    drawFrame()
    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [phase, detectedFaces, faceMatchResults, scanStatus])

  // ============ Render ============

  // --- Shared top bar ---
  const TopBar = ({ children }: { children?: React.ReactNode }) => (
    <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shadow-sm">
      <div className="flex items-center gap-3">
        <Image src="/verifaceqcu.jpg" alt="VeriFace" width={40} height={40} className="rounded-lg" />
        <div>
          <h1 className="text-base font-bold tracking-tight text-gray-900">VeriFace Attendance</h1>
          {children}
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${serverHealthy ? 'bg-emerald-500' : 'bg-red-400'}`} />
          <span className="text-xs text-gray-400">{serverHealthy ? 'Online' : 'Offline'}</span>
        </div>
        <button onClick={() => setSoundEnabled(!soundEnabled)} className="text-gray-400 hover:text-gray-600 transition">
          {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        <div className="text-right">
          <p className="text-lg font-mono font-semibold tabular-nums text-gray-800" suppressHydrationWarning>
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-[10px] text-gray-400 leading-none" suppressHydrationWarning>
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>
    </div>
  )

  // --- Phase 1: Professor Scan ---
  if (phase === 'professor-scan') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
        <TopBar>
          <p className="text-xs text-gray-400">Professor verification required</p>
        </TopBar>

        {/* Login links - subtle, top right below bar */}
        <div className="flex justify-end px-6 pt-3 gap-2">
          <button
            onClick={() => router.push('/admin/login')}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:text-emerald-600 bg-white border border-gray-200 hover:border-emerald-200 rounded-lg transition-all"
          >
            <ShieldCheck className="w-3 h-3" />
            Admin
          </button>
          <button
            onClick={() => router.push('/professor/login')}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:text-emerald-600 bg-white border border-gray-200 hover:border-emerald-200 rounded-lg transition-all"
          >
            Faculty
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-2">Step 1</p>
            <h2 className="text-2xl font-bold mb-1 text-gray-900">Professor Verification</h2>
            <p className="text-sm text-gray-400 mb-6">Position your face in front of the camera to begin</p>

            {/* Camera Feed */}
            <div className={`relative rounded-2xl overflow-hidden border-2 shadow-lg transition-all duration-500 mx-auto ${getProfessorBorderColor()}`}
                 style={{ width: '560px', height: '420px' }}>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay playsInline muted
                style={{ transform: 'scaleX(-1)' }}
              />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ transform: 'scaleX(-1)' }} />

              {/* Status Overlay */}
              <div className="absolute top-3 inset-x-0 flex justify-center">
                <div className={`text-white text-xs font-medium px-3 py-1.5 rounded-lg backdrop-blur-md flex items-center gap-1.5 ${
                  professorScanStatus === 'matched' ? 'bg-emerald-600/90' :
                  professorScanStatus === 'not-found' ? 'bg-red-500/90' :
                  professorScanStatus === 'scanning' ? 'bg-blue-500/90' :
                  faceDetected ? 'bg-gray-700/80' : 'bg-gray-900/60'
                }`}>
                  {professorScanStatus === 'matched' ? (
                    <><CheckCircle className="w-3.5 h-3.5" /> Professor recognized</>
                  ) : professorScanStatus === 'scanning' ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying...</>
                  ) : professorScanStatus === 'not-found' ? (
                    'Face not recognized'
                  ) : faceDetected ? (
                    <><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Face detected</>
                  ) : (
                    'Waiting for face...'
                  )}
                </div>
              </div>

              {/* Match success overlay */}
              {professorScanStatus === 'matched' && professor && (
                <div className="absolute inset-0 bg-emerald-900/30 flex items-center justify-center backdrop-blur-[2px]">
                  <div className="text-center bg-white/95 rounded-2xl px-8 py-6 shadow-xl">
                    <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                    <p className="text-lg font-bold text-gray-900">
                      Welcome, Prof. {professor.firstName} {professor.lastName}
                    </p>
                    <p className="text-sm text-gray-400 mt-1">Loading schedule...</p>
                  </div>
                </div>
              )}
            </div>

            {statusMessage && (
              <p className="mt-4 text-sm text-amber-600 font-medium">{statusMessage}</p>
            )}

            {!serverHealthy && (
              <div className="mt-4 flex items-center justify-center gap-1.5 text-amber-600 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>Recognition server unavailable</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // --- Phase 2: Schedule Select ---
  if (phase === 'schedule-select') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
        <TopBar>
          {professor && <p className="text-xs text-emerald-600">Prof. {professor.firstName} {professor.lastName}</p>}
        </TopBar>

        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-xl w-full">
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-2 text-center">Step 2</p>
            <h2 className="text-2xl font-bold mb-1 text-center text-gray-900">Select Class Session</h2>
            <p className="text-sm text-gray-400 text-center mb-8">
              {schedules.length} class{schedules.length > 1 ? 'es' : ''} available today
            </p>

            <div className="space-y-3">
              {schedules.map(schedule => (
                <button
                  key={schedule.id}
                  onClick={() => selectSchedule(schedule)}
                  className="w-full p-5 bg-white border border-gray-200 rounded-xl hover:border-emerald-300 hover:shadow-md transition-all group text-left"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-base font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">
                          {schedule.sectionCode}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-medium">
                          {schedule.room}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <Timer className="w-3 h-3" />
                          {formatTime(schedule.startTime)} — {formatTime(schedule.endTime)}
                        </span>
                        <span>{schedule.totalStudents} students</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-emerald-500 transition-colors" />
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={resetToScan}
              className="mt-6 w-full py-2.5 text-gray-400 hover:text-gray-700 transition-colors text-xs flex items-center justify-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back to professor scan
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- Phase 3 & 4: Attendance Active / Locked ---
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shadow-sm">
        <div className="flex items-center gap-3">
          <Image src="/verifaceqcu.jpg" alt="VeriFace" width={40} height={40} className="rounded-lg" />
          <div>
            <h1 className="text-base font-bold tracking-tight text-gray-900">VeriFace Attendance</h1>
            {professor && selectedSchedule && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded">
                  {selectedSchedule.sectionCode}
                </span>
                <p className="text-xs text-gray-400">
                  {selectedSchedule.room} · Prof. {professor.firstName} {professor.lastName}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          {/* Lock countdown */}
          {phase === 'attendance-active' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg">
              <Timer className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-mono font-semibold text-amber-600">{lockTimeRemaining}</span>
              <span className="text-[10px] text-amber-400">until lock</span>
            </div>
          )}

          {phase === 'attendance-locked' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 border border-red-200 rounded-lg">
              <Lock className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs font-semibold text-red-500">LOCKED</span>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${serverHealthy ? 'bg-emerald-500' : 'bg-red-400'}`} />
            <span className="text-xs text-gray-400">{serverHealthy ? 'Online' : 'Offline'}</span>
          </div>

          <button onClick={() => setSoundEnabled(!soundEnabled)} className="text-gray-400 hover:text-gray-600 transition">
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <div className="text-right">
            <p className="text-lg font-mono font-semibold tabular-nums text-gray-800" suppressHydrationWarning>
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-[10px] text-gray-400 leading-none" suppressHydrationWarning>
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Left: Camera Feed */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {/* Locked Banner */}
          {phase === 'attendance-locked' && (
            <div className="mb-5 px-5 py-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
              <Lock className="w-5 h-5 text-red-500" />
              <div>
                <span className="text-red-700 font-bold text-sm">Attendance Session Closed</span>
                <p className="text-red-400 text-xs">Unscanned students have been marked absent.</p>
              </div>
            </div>
          )}

          {/* Camera */}
          <div className={`relative rounded-2xl overflow-hidden border-2 shadow-lg transition-all duration-500 mx-auto ${
            phase === 'attendance-locked' ? 'border-red-300 opacity-60' : getStatusColor()
          }`}
               style={{ width: '560px', height: '420px' }}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay playsInline muted
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas
              ref={attendanceCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Face count */}
            {detectedFaces.length > 0 && phase === 'attendance-active' && (
              <div className="absolute top-3 left-3 bg-black/50 text-white text-xs font-medium px-2.5 py-1 rounded-lg backdrop-blur flex items-center gap-1.5">
                <Scan className="w-3 h-3" />
                {detectedFaces.length} face{detectedFaces.length > 1 ? 's' : ''}
              </div>
            )}

            {/* Scanning indicator */}
            {scanStatus === 'scanning' && (
              <div className="absolute top-3 right-3 bg-blue-500/80 text-white text-xs font-medium px-2.5 py-1 rounded-lg backdrop-blur flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Scanning...
              </div>
            )}

            {/* Matched faces summary */}
            {scanStatus === 'matched' && faceMatchResults.length > 0 && (
              <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-emerald-900/70 to-transparent pt-10 pb-3 px-3">
                <div className="flex flex-wrap justify-center gap-1.5">
                  {faceMatchResults.filter(r => r.status === 'matched').map((r, i) => (
                    <span key={i} className="bg-white/90 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {phase === 'attendance-locked' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="bg-white/95 rounded-2xl px-8 py-6 text-center shadow-xl">
                  <Lock className="w-10 h-10 text-red-400 mx-auto mb-2" />
                  <span className="text-sm font-bold text-gray-900">SESSION CLOSED</span>
                </div>
              </div>
            )}
          </div>

          {/* Status Message */}
          <div className="mt-5 min-h-10 flex items-center justify-center">
            {statusMessage ? (
              <p className={`text-sm font-medium text-center max-w-xl ${
                scanStatus === 'matched' ? 'text-emerald-600' :
                scanStatus === 'no-match' ? 'text-red-500' :
                scanStatus === 'already-marked' ? 'text-blue-500' :
                scanStatus === 'locked' ? 'text-amber-500' :
                'text-gray-400'
              }`}>
                {statusMessage}
              </p>
            ) : phase === 'attendance-active' ? (
              <p className="text-gray-400 text-sm">Step in front of the camera to mark attendance</p>
            ) : null}
          </div>

          {/* Class Time Info */}
          {selectedSchedule && (
            <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                {formatTime(selectedSchedule.startTime)} — {formatTime(selectedSchedule.endTime)}
              </span>
              <span className="text-gray-300">|</span>
              <span>Present: 0-20 min · Late: 20-30 min · Lock: 30 min</span>
            </div>
          )}

          {phase === 'attendance-locked' && (
            <button
              onClick={resetToScan}
              className="mt-5 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm rounded-xl transition-colors font-medium"
            >
              Start New Session
            </button>
          )}
        </div>

        {/* Right: Student List & Stats */}
        <div className="w-96 border-l border-gray-100 bg-white flex flex-col">
          {/* Stats */}
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Attendance Summary</h2>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg p-2.5 text-center bg-emerald-50 border border-emerald-100">
                <p className="text-xl font-bold text-emerald-600">{stats.present}</p>
                <p className="text-[10px] text-emerald-500 mt-0.5">Present</p>
              </div>
              <div className="rounded-lg p-2.5 text-center bg-amber-50 border border-amber-100">
                <p className="text-xl font-bold text-amber-600">{stats.late}</p>
                <p className="text-[10px] text-amber-500 mt-0.5">Late</p>
              </div>
              <div className="rounded-lg p-2.5 text-center bg-red-50 border border-red-100">
                <p className="text-xl font-bold text-red-500">{stats.absent}</p>
                <p className="text-[10px] text-red-400 mt-0.5">Absent</p>
              </div>
              <div className="rounded-lg p-2.5 text-center bg-gray-50 border border-gray-100">
                <p className="text-xl font-bold text-gray-500">{stats.pending}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Pending</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
              {stats.total > 0 && (
                <>
                  <div className="bg-emerald-500 transition-all" style={{ width: `${(stats.present / stats.total) * 100}%` }} />
                  <div className="bg-amber-400 transition-all" style={{ width: `${(stats.late / stats.total) * 100}%` }} />
                  <div className="bg-red-400 transition-all" style={{ width: `${(stats.absent / stats.total) * 100}%` }} />
                </>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 text-right">{stats.present + stats.late} / {stats.total} checked in</p>
          </div>

          {/* Student List */}
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
              Students ({enrolledStudents.length})
            </h2>
            {enrolledStudents.length === 0 ? (
              <div className="text-center py-10 text-gray-300">
                <p className="text-xs">No students enrolled</p>
              </div>
            ) : (
              <div className="space-y-1">
                {enrolledStudents.map(student => (
                  <div
                    key={student.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all ${
                      student.status === 'present'
                        ? 'bg-emerald-50/50 border-emerald-100'
                        : student.status === 'late'
                        ? 'bg-amber-50/50 border-amber-100'
                        : student.status === 'absent'
                        ? 'bg-red-50/50 border-red-100'
                        : 'bg-gray-50/50 border-gray-100'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      student.status === 'present' ? 'bg-emerald-100 text-emerald-600' :
                      student.status === 'late' ? 'bg-amber-100 text-amber-600' :
                      student.status === 'absent' ? 'bg-red-100 text-red-500' :
                      'bg-gray-100 text-gray-400'
                    }`}>
                      {student.status === 'present' ? <CheckCircle className="w-3.5 h-3.5" /> :
                       student.status === 'late' ? <Clock className="w-3.5 h-3.5" /> :
                       student.status === 'absent' ? <XCircle className="w-3.5 h-3.5" /> :
                       <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${
                        student.status === 'pending' ? 'text-gray-400' : 'text-gray-800'
                      }`}>
                        {student.lastName}, {student.firstName}
                      </p>
                      <p className="text-[10px] text-gray-400">{student.studentNumber}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        student.status === 'present' ? 'bg-emerald-100 text-emerald-600' :
                        student.status === 'late' ? 'bg-amber-100 text-amber-600' :
                        student.status === 'absent' ? 'bg-red-100 text-red-500' :
                        'bg-gray-100 text-gray-400'
                      }`}>
                        {student.status.toUpperCase()}
                      </span>
                      {student.checkedInAt && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {new Date(student.checkedInAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
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
