'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CheckCircle, XCircle, Clock, AlertTriangle, Loader2, Volume2, VolumeX, Users, Lock, GraduationCap, BookOpen, Scan, ShieldCheck } from 'lucide-react'
import { extractFaceNetFromVideo, checkFaceNetHealth, loadSessionEncodings, clearSessionEncodings, RealtimeRecognizer } from '@/lib/facenet-python-api'
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
  const isMatchingRef = useRef<boolean>(false)
  const hasMarkedAbsentRef = useRef<boolean>(false)

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
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
      }
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

    const scanProfessor = async () => {
      if (!videoRef.current || isMatchingRef.current) return

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

        if (pythonResult.detected && pythonResult.embedding) {
          setFaceDetected(true)

          if (!isMatchingRef.current) {
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

                // Fetch professor's schedules for today
                const schedRes = await fetch(`/api/kiosk/professor-schedule?professorId=${prof.id}`)
                const schedData = await schedRes.json()

                if (schedData.success && schedData.schedules.length > 0) {
                  setSchedules(schedData.schedules)
                  if (schedData.schedules.length === 1) {
                    // Auto-select if only one schedule
                    selectSchedule(schedData.schedules[0])
                  } else {
                    setPhase('schedule-select')
                  }
                } else {
                  setStatusMessage('No classes scheduled for today')
                  setTimeout(() => {
                    resetToScan()
                  }, 3000)
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
          }
        } else {
          setFaceDetected(false)
          if (professorScanStatus === 'scanning') {
            setProfessorScanStatus('idle')
          }
        }
      } catch (error) {
        console.error('Professor scan error:', error)
      }
    }

    scanIntervalRef.current = setInterval(scanProfessor, 300)
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current)
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

    const fetchStudents = async () => {
      try {
        const res = await fetch(`/api/attendance/enrolled-students?sectionId=${selectedSchedule.sectionId}`)
        const data = await res.json()
        if (data.success) {
          setEnrolledStudents(data.students)
          setStats(data.stats)
        }
      } catch (err) {
        console.error('Failed to fetch students:', err)
      }
    }

    fetchStudents()
    const interval = setInterval(fetchStudents, 5000)
    return () => clearInterval(interval)
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
              : '\uD83D\uDD0D Scanning...'

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

          // Mirror the x coordinate since video is flipped
          const mirroredLeft = canvas.width - box.right
          const x = mirroredLeft
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
          const labelText = status === 'matched' ? `✓ ${name}` :
                            status === 'already-marked' ? `● ${name}` :
                            '✗ Unknown'
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

          ctx.fillStyle = 'white'
          ctx.fillText(labelText, lx + pd, ly + 19)
        }
      } else if (detectedFaces.length > 0 && scanStatus === 'scanning') {
        // Draw neutral boxes for detected faces while scanning
        for (const face of detectedFaces) {
          const mirroredLeft = canvas.width - face.box.right
          ctx.strokeStyle = '#eab308'
          ctx.lineWidth = 2
          ctx.setLineDash([8, 4])
          ctx.strokeRect(mirroredLeft, face.box.top, face.box.width, face.box.height)
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

  // --- Phase 1: Professor Scan ---
  if (phase === 'professor-scan') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur border-b border-gray-200">
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Camera className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">VeriFace Attendance Kiosk</h1>
              <p className="text-sm text-gray-500">Professor verification required</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Login Links */}
            <div className="flex items-center gap-2">
              <button 
                onClick={() => router.push('/admin/login')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-primary bg-white hover:bg-primary/5 border border-gray-300 hover:border-primary/50 rounded-full transition-all cursor-pointer shadow-sm hover:shadow"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Admin
              </button>
              <button 
                onClick={() => router.push('/professor/login')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-violet-600 bg-white hover:bg-violet-50 border border-gray-300 hover:border-violet-300 rounded-full transition-all cursor-pointer shadow-sm hover:shadow"
              >
                <GraduationCap className="w-3.5 h-3.5" />
                Faculty
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${serverHealthy ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
              <span className="text-xs text-gray-500">{serverHealthy ? 'Online' : 'Offline'}</span>
            </div>
            <button onClick={() => setSoundEnabled(!soundEnabled)} className="text-gray-400 hover:text-gray-900 transition">
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <div className="text-right">
              <p className="text-2xl font-mono font-bold tabular-nums" suppressHydrationWarning>
                {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
              <p className="text-xs text-gray-400" suppressHydrationWarning>
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-2xl">
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-full text-emerald-600 text-sm font-medium mb-4">
                <GraduationCap className="w-4 h-4" />
                Step 1: Professor Verification
              </div>
              <h2 className="text-3xl font-bold mb-2">Scan Your Face to Begin</h2>
              <p className="text-gray-500">Position your face in front of the camera to open your class session</p>
            </div>

            {/* Camera Feed */}
            <div className={`relative rounded-3xl overflow-hidden border-4 shadow-2xl transition-all duration-500 mx-auto ${getProfessorBorderColor()}`}
                 style={{ width: '560px', height: '420px' }}>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay playsInline muted
                style={{ transform: 'scaleX(-1)' }}
              />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ transform: 'scaleX(-1)' }} />

              {/* Status Overlay */}
              <div className="absolute top-4 inset-x-0 flex justify-center">
                <div className={`text-white text-sm font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2 ${
                  professorScanStatus === 'matched' ? 'bg-emerald-600' :
                  professorScanStatus === 'not-found' ? 'bg-red-600' :
                  professorScanStatus === 'scanning' ? 'bg-blue-600' :
                  faceDetected ? 'bg-gray-700' : 'bg-gray-900/80'
                }`}>
                  {professorScanStatus === 'matched' ? (
                    <><CheckCircle className="w-4 h-4" /> Professor recognized</>
                  ) : professorScanStatus === 'scanning' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>
                  ) : professorScanStatus === 'not-found' ? (
                    'Face not recognized — Try again'
                  ) : faceDetected ? (
                    <><span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Face detected</>
                  ) : (
                    'Position your face in the camera'
                  )}
                </div>
              </div>

              {/* Match success overlay */}
              {professorScanStatus === 'matched' && professor && (
                <div className="absolute inset-0 bg-emerald-900/40 flex items-center justify-center">
                  <div className="text-center">
                    <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-3" />
                    <p className="text-2xl font-bold text-emerald-300">
                      Welcome, Prof. {professor.firstName} {professor.lastName}!
                    </p>
                    <p className="text-emerald-400/70 mt-2">Loading your schedule...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Status Message */}
            {statusMessage && (
              <p className="mt-4 text-lg text-amber-600 font-medium">{statusMessage}</p>
            )}

            {!serverHealthy && (
              <div className="mt-6 flex items-center justify-center gap-2 text-amber-600">
                <AlertTriangle className="w-5 h-5" />
                <span>Face recognition server is unavailable</span>
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
        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur border-b border-gray-200">
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Camera className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">VeriFace Attendance Kiosk</h1>
              {professor && (
                <p className="text-sm text-emerald-600">Prof. {professor.firstName} {professor.lastName}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-2xl font-mono font-bold tabular-nums" suppressHydrationWarning>
                {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
              <p className="text-xs text-gray-400" suppressHydrationWarning>
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>
        </div>

        {/* Schedule Selection */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-full text-blue-600 text-sm font-medium mb-4">
                <BookOpen className="w-4 h-4" />
                Step 2: Select Class
              </div>
              <h2 className="text-3xl font-bold mb-2">Select Your Class Session</h2>
              <p className="text-gray-500">You have {schedules.length} class{schedules.length > 1 ? 'es' : ''} today. Choose which one to open attendance for.</p>
            </div>

            <div className="space-y-4">
              {schedules.map(schedule => (
                <button
                  key={schedule.id}
                  onClick={() => selectSchedule(schedule)}
                  className="w-full p-6 bg-white border border-gray-200 rounded-2xl hover:border-emerald-400 hover:bg-emerald-50/50 shadow-sm transition-all group text-left"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-lg font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">
                          {schedule.sectionCode}
                        </span>
                        <span className="text-xs px-2 py-1 bg-gray-100 rounded-full text-gray-500">
                          {schedule.room}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {formatTime(schedule.startTime)} — {formatTime(schedule.endTime)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          {schedule.totalStudents} students
                        </span>
                      </div>
                    </div>
                    <div className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Scan className="w-8 h-8" />
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={resetToScan}
              className="mt-6 w-full py-3 text-gray-400 hover:text-gray-900 transition-colors text-sm"
            >
              \u2190 Back to professor scan
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
      <div className="flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="flex items-center gap-4">
          <div className="bg-primary/10 p-2 rounded-lg">
            <Camera className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">VeriFace Attendance Kiosk</h1>
            {professor && selectedSchedule && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded">
                  {selectedSchedule.sectionCode}
                </span>
                <p className="text-sm text-gray-500">
                  {selectedSchedule.room} • Prof. {professor.firstName} {professor.lastName}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Lock countdown */}
          {phase === 'attendance-active' && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-mono text-amber-400">{lockTimeRemaining}</span>
              <span className="text-xs text-amber-400/70">until lock</span>
            </div>
          )}

          {phase === 'attendance-locked' && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg">
              <Lock className="w-4 h-4 text-red-400" />
              <span className="text-sm font-semibold text-red-400">LOCKED</span>
            </div>
          )}

          {/* Server Status */}
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${serverHealthy ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
            <span className="text-xs text-gray-500">{serverHealthy ? 'Online' : 'Offline'}</span>
          </div>

          {/* Sound Toggle */}
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="text-gray-400 hover:text-gray-900 transition">
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          {/* Clock */}
          <div className="text-right">
            <p className="text-2xl font-mono font-bold tabular-nums" suppressHydrationWarning>
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-xs text-gray-500" suppressHydrationWarning>
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
            <div className="mb-6 px-6 py-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
              <Lock className="w-6 h-6 text-red-500" />
              <div>
                <span className="text-red-700 font-bold text-lg">Attendance Session Closed</span>
                <p className="text-red-500/70 text-sm">All unscanned students have been marked as absent.</p>
              </div>
            </div>
          )}

          {/* Camera */}
          <div className={`relative rounded-3xl overflow-hidden border-4 shadow-2xl transition-all duration-500 mx-auto ${
            phase === 'attendance-locked' ? 'border-red-500/50 opacity-60' : getStatusColor()
          }`}
               style={{ width: '560px', height: '420px' }}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay playsInline muted
              style={{ transform: 'scaleX(-1)' }}
            />
            {/* Multi-face bounding box canvas overlay */}
            <canvas
              ref={attendanceCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Face count indicator */}
            {detectedFaces.length > 0 && phase === 'attendance-active' && (
              <div className="absolute top-4 left-4 bg-black/60 text-white text-sm font-medium px-3 py-1.5 rounded-full backdrop-blur-md flex items-center gap-2">
                <Users className="w-4 h-4" />
                {detectedFaces.length} face{detectedFaces.length > 1 ? 's' : ''} detected
              </div>
            )}

            {/* Scanning overlay (semi-transparent, no full-screen block) */}
            {scanStatus === 'scanning' && (
              <div className="absolute top-4 right-4 bg-yellow-500/80 text-white text-sm font-medium px-3 py-1.5 rounded-full backdrop-blur-md flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Scanning {detectedFaces.length} face{detectedFaces.length > 1 ? 's' : ''}...
              </div>
            )}

            {/* Multi-face matched summary (bottom overlay) */}
            {scanStatus === 'matched' && faceMatchResults.length > 0 && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-green-900/80 to-transparent pt-12 pb-4 px-4">
                <div className="flex flex-wrap justify-center gap-2">
                  {faceMatchResults.filter(r => r.status === 'matched').map((r, i) => (
                    <span key={i} className="bg-green-500/90 text-white text-sm font-bold px-3 py-1 rounded-full flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {phase === 'attendance-locked' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="flex flex-col items-center gap-2">
                  <Lock className="w-16 h-16 text-red-400" />
                  <span className="text-lg font-bold text-red-300">SESSION CLOSED</span>
                </div>
              </div>
            )}
          </div>

          {/* Status Message */}
          <div className="mt-6 min-h-12 flex items-center justify-center">
            {statusMessage ? (
              <p className={`text-lg font-semibold text-center max-w-xl ${
                scanStatus === 'matched' ? 'text-green-600' :
                scanStatus === 'no-match' ? 'text-red-600' :
                scanStatus === 'already-marked' ? 'text-blue-600' :
                scanStatus === 'locked' ? 'text-orange-600' :
                'text-gray-500'
              }`}>
                {statusMessage}
              </p>
            ) : phase === 'attendance-active' ? (
              <p className="text-gray-500 text-lg">Step in front of the camera to mark attendance — supports multiple faces</p>
            ) : null}
          </div>

          {/* Class Time Info */}
          {selectedSchedule && (
            <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatTime(selectedSchedule.startTime)} — {formatTime(selectedSchedule.endTime)}
              </span>
              <span>|</span>
              <span>Present: 0-20 min • Late: 20-30 min • Lock: 30 min</span>
            </div>
          )}

          {/* End Session button (only when locked) */}
          {phase === 'attendance-locked' && (
            <button
              onClick={resetToScan}
              className="mt-6 px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-colors font-medium"
            >
              Start New Session
            </button>
          )}
        </div>

        {/* Right: Student List & Stats */}
        <div className="w-105 border-l border-gray-200 bg-white flex flex-col">
          {/* Stats */}
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Attendance Summary</h2>
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-green-50 rounded-xl p-3 text-center border border-green-200">
                <p className="text-2xl font-bold text-green-600">{stats.present}</p>
                <p className="text-xs text-green-600/70 mt-0.5">Present</p>
              </div>
              <div className="bg-yellow-50 rounded-xl p-3 text-center border border-yellow-200">
                <p className="text-2xl font-bold text-yellow-600">{stats.late}</p>
                <p className="text-xs text-yellow-600/70 mt-0.5">Late</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center border border-red-200">
                <p className="text-2xl font-bold text-red-600">{stats.absent}</p>
                <p className="text-xs text-red-600/70 mt-0.5">Absent</p>
              </div>
              <div className="bg-gray-100 rounded-xl p-3 text-center border border-gray-200">
                <p className="text-2xl font-bold text-gray-600">{stats.pending}</p>
                <p className="text-xs text-gray-500/70 mt-0.5">Pending</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-4 h-2 bg-gray-200 rounded-full overflow-hidden flex">
              {stats.total > 0 && (
                <>
                  <div className="bg-green-500 transition-all" style={{ width: `${(stats.present / stats.total) * 100}%` }} />
                  <div className="bg-yellow-500 transition-all" style={{ width: `${(stats.late / stats.total) * 100}%` }} />
                  <div className="bg-red-500 transition-all" style={{ width: `${(stats.absent / stats.total) * 100}%` }} />
                </>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2 text-right">{stats.present + stats.late} / {stats.total} checked in</p>
          </div>

          {/* Student List */}
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-2">
              Student List ({enrolledStudents.length})
            </h2>
            {enrolledStudents.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No students enrolled</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {enrolledStudents.map(student => (
                  <div
                    key={student.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                      student.status === 'present'
                        ? 'bg-green-50 border-green-200'
                        : student.status === 'late'
                        ? 'bg-yellow-50 border-yellow-200'
                        : student.status === 'absent'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    {/* Status indicator */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      student.status === 'present' ? 'bg-green-100 text-green-600' :
                      student.status === 'late' ? 'bg-yellow-100 text-yellow-600' :
                      student.status === 'absent' ? 'bg-red-100 text-red-600' :
                      'bg-gray-200 text-gray-500'
                    }`}>
                      {student.status === 'present' ? '\u2713' :
                       student.status === 'late' ? '\u23F0' :
                       student.status === 'absent' ? '\u2717' :
                       '\u2014'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${
                        student.status === 'pending' ? 'text-gray-500' : 'text-gray-900'
                      }`}>
                        {student.lastName}, {student.firstName}
                      </p>
                      <p className="text-xs text-gray-500">{student.studentNumber}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        student.status === 'present' ? 'bg-green-100 text-green-600' :
                        student.status === 'late' ? 'bg-yellow-100 text-yellow-600' :
                        student.status === 'absent' ? 'bg-red-100 text-red-600' :
                        'bg-gray-200 text-gray-500'
                      }`}>
                        {student.status === 'present' ? 'PRESENT' :
                         student.status === 'late' ? 'LATE' :
                         student.status === 'absent' ? 'ABSENT' :
                         'PENDING'}
                      </span>
                      {student.checkedInAt && (
                        <p className="text-xs text-gray-400 mt-0.5">
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
