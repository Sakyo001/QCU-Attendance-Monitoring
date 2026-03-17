'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NextImage from 'next/image'
import { CheckCircle, XCircle, Clock, AlertTriangle, Loader2, Volume2, VolumeX, Users, Lock, Scan, ShieldCheck, ArrowLeft, ChevronLeft, ChevronRight, MapPin, Timer, Megaphone, Lightbulb } from 'lucide-react'
import { checkFaceNetHealth, waitForModelReady, loadSessionEncodings, clearSessionEncodings, ServerCameraStream } from '@/lib/facenet-python-api'
import type { DetectedFace, RecognizedFace, RecognitionResult, FaceNetEmbedding, CameraStreamFrame, CameraStreamMode } from '@/lib/facenet-python-api'

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

// ============ Idle screen data ============

const IDLE_ANNOUNCEMENTS = [
  { id: '1', title: 'Final Exams Schedule', message: 'Final examinations will be held from March 15-22, 2026. Please check your respective schedules.', type: 'warning' as const },
  { id: '2', title: 'University Foundation Day', message: 'Join us in celebrating our 50th Anniversary on February 14, 2026. Activities start at 8:00 AM.', type: 'event' as const },
  { id: '3', title: 'Enrollment Advisory', message: 'Mid-year enrollment is now open. Visit the registrar office for more details.', type: 'info' as const },
  { id: '4', title: 'Library Extended Hours', message: 'The university library will extend hours until 10:00 PM during exam week.', type: 'info' as const },
  { id: '5', title: 'Sports Fest 2026', message: 'Annual Sports Festival is scheduled for February 20-21. Sign up at the PE office.', type: 'event' as const },
]

const IDLE_TRIVIA = [
  { question: 'Did you know?', answer: 'QCU was established in 1994 through Republic Act 9805 and is one of the leading universities in Quezon City.' },
  { question: 'Fun Fact', answer: 'The average human face has 43 muscles. Our face recognition system maps 478 unique landmarks to identify you!' },
  { question: 'Tech Trivia', answer: 'FaceNet, developed by Google, can achieve 99.63% accuracy on the Labeled Faces in the Wild benchmark.' },
  { question: 'Campus Tip', answer: 'The university library offers free access to online journals and research databases for all enrolled students.' },
  { question: 'Did you know?', answer: 'Attendance tracking started with paper rolls in the 1800s. Today, AI-powered face recognition does it in under a second!' },
  { question: 'Study Hack', answer: 'The Pomodoro Technique - 25 minutes of focused study followed by a 5-minute break - can boost productivity by up to 25%.' },
]

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
  const serverCameraCanvasRef = useRef<HTMLCanvasElement>(null)
  const serverCameraImgRef = useRef<HTMLImageElement | null>(null)
  const serverStreamRef = useRef<ServerCameraStream | null>(null)
  const pendingFrameRef = useRef<CameraStreamFrame | null>(null)
  const rafRef = useRef<number>(0)
  const cameraConnectedRef = useRef(false)
  const lastFpsUpdateRef = useRef(0)
  const [cameraMode, setCameraMode] = useState<CameraStreamMode>('extract')
  const [cameraConnected, setCameraConnected] = useState(false)
  const [cameraFps, setCameraFps] = useState(0)
  const isMatchingRef = useRef<boolean>(false)
  const hasMarkedAbsentRef = useRef<boolean>(false)
  const scanCooldownUntilRef = useRef<number>(0)

  // --- General state ---
  const [serverHealthy, setServerHealthy] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [soundEnabled, setSoundEnabled] = useState(true)

  // --- Offline mode (for Supabase-backed APIs) ---
  const [systemOffline, setSystemOffline] = useState(false)
  const [queuedMarksCount, setQueuedMarksCount] = useState(0)

  // --- Professor scan UI ---
  const [professorScanStatus, setProfessorScanStatus] = useState<'idle' | 'scanning' | 'matched' | 'not-found'>('idle')
  const [faceDetected, setFaceDetected] = useState(false)
  const [spoofDetected, setSpoofDetected] = useState(false)
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  // --- Attendance state ---
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'matched' | 'no-match' | 'already-marked' | 'locked'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([])
  const [studentPage, setStudentPage] = useState(0)
  const [stats, setStats] = useState({ present: 0, late: 0, absent: 0, pending: 0, total: 0 })
  const [attendanceLocked, setAttendanceLocked] = useState(false)
  const [lockTimeRemaining, setLockTimeRemaining] = useState('')

  // --- Multi-face state ---
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([])
  const [faceMatchResults, setFaceMatchResults] = useState<Array<{ box: DetectedFace['box']; name: string; status: 'matched' | 'no-match' | 'already-marked' }>>([])
  const attendanceCanvasRef = useRef<HTMLCanvasElement>(null)
  const professorOverlayRef = useRef<HTMLCanvasElement>(null)
  const markedStudentIdsRef = useRef<Set<string>>(new Set())
  const markedStudentNumbersRef = useRef<Set<string>>(new Set())
  const markingStudentIdsRef = useRef<Set<string>>(new Set())
  const lastActivityRef = useRef<number>(Date.now())
  const [isIdle, setIsIdle] = useState(false)
  const idleVideoRef = useRef<HTMLVideoElement>(null)
  const [idleAnnouncementIdx, setIdleAnnouncementIdx] = useState(0)
  const [idleTriviaIdx, setIdleTriviaIdx] = useState(0)

  // ============ Effects ============

  // Track browser online/offline events (network availability)
  useEffect(() => {
    const update = () => {
      // navigator.onLine is a best-effort signal; we also flip to offline on fetch network errors.
      setSystemOffline(!navigator.onLine)
    }
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // ============ Session Persistence (survives tab discard / page reload) ============
  const SESSION_KEY = 'kiosk-session-v1'

  const MARK_QUEUE_KEY = 'kiosk-attendance-mark-queue-v1'
  const rosterCacheKey = (sectionId: string) => `kiosk-roster-cache-v1:${sectionId}`
  const encodingsCacheKey = (sectionId: string) => `kiosk-encodings-cache-v1:${sectionId}`
  const localMarksCacheKey = (sectionId: string) => `kiosk-local-marks-v1:${sectionId}`

  type AttendanceMarkQueueItem = {
    id: string
    sectionId: string
    studentId: string
    studentNumber?: string
    scheduleId?: string
    faceMatchConfidence?: number
    queuedAt: string
  }

  type LocalMarkedStudent = {
    studentId: string
    studentNumber: string
    firstName: string
    lastName: string
    status: 'present' | 'late'
    checkedInAt: string
    confidence: number | null
  }

  const isLikelyNetworkError = (err: unknown) => {
    // In browsers, fetch() network failures typically surface as TypeError.
    return err instanceof TypeError
  }

  const loadQueue = (): AttendanceMarkQueueItem[] => {
    try {
      const raw = localStorage.getItem(MARK_QUEUE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed as AttendanceMarkQueueItem[]
    } catch {
      return []
    }
  }

  const saveQueue = (items: AttendanceMarkQueueItem[]) => {
    try {
      localStorage.setItem(MARK_QUEUE_KEY, JSON.stringify(items))
      setQueuedMarksCount(items.length)
    } catch {
      // If storage is full or blocked, we still want the UI to behave gracefully.
      setQueuedMarksCount(items.length)
    }
  }

  const loadLocalMarks = (sectionId: string): Record<string, LocalMarkedStudent> => {
    try {
      const raw = sessionStorage.getItem(localMarksCacheKey(sectionId))
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return {}
      return parsed as Record<string, LocalMarkedStudent>
    } catch {
      return {}
    }
  }

  const saveLocalMarks = (sectionId: string, marks: Record<string, LocalMarkedStudent>) => {
    try {
      sessionStorage.setItem(localMarksCacheKey(sectionId), JSON.stringify(marks))
    } catch {
      // Ignore storage failures; state will still reflect local marks.
    }
  }

  const upsertLocalMark = (sectionId: string, mark: LocalMarkedStudent) => {
    const marks = loadLocalMarks(sectionId)
    const normalizedStudentNumber = String(mark.studentNumber || '').trim().toLowerCase()
    const key = normalizedStudentNumber ? `sn:${normalizedStudentNumber}` : `id:${mark.studentId}`

    // Remove stale entries for the same student number to avoid duplicate rows after re-registration.
    if (normalizedStudentNumber) {
      for (const [existingKey, existingMark] of Object.entries(marks)) {
        const existingNumber = String(existingMark.studentNumber || '').trim().toLowerCase()
        if (existingKey !== key && existingNumber && existingNumber === normalizedStudentNumber) {
          delete marks[existingKey]
        }
      }
    }

    marks[key] = mark
    saveLocalMarks(sectionId, marks)
  }

  const applyLocalMarksToRoster = (sectionId: string, students: EnrolledStudent[]): EnrolledStudent[] => {
    const marks = loadLocalMarks(sectionId)
    const markValues = Object.values(marks)
    if (markValues.length === 0) return students

    const markById = new Map(markValues.map((m) => [m.studentId, m]))
    const markByStudentNumber = new Map(
      markValues
        .filter((m) => String(m.studentNumber || '').trim().length > 0)
        .map((m) => [String(m.studentNumber).trim().toLowerCase(), m])
    )

    const existingIds = new Set(students.map((s) => s.id))
    const existingStudentNumbers = new Set(
      students
        .map((s) => String(s.studentNumber || '').trim().toLowerCase())
        .filter(Boolean)
    )

    const merged = students.map((s) => {
      const normalizedStudentNumber = String(s.studentNumber || '').trim().toLowerCase()
      const mark = (normalizedStudentNumber ? markByStudentNumber.get(normalizedStudentNumber) : undefined) || markById.get(s.id)
      if (!mark) return s
      return {
        ...s,
        studentNumber: s.studentNumber || mark.studentNumber,
        status: mark.status,
        checkedInAt: mark.checkedInAt,
        confidence: mark.confidence,
      }
    })

    for (const mark of markValues) {
      const normalizedStudentNumber = String(mark.studentNumber || '').trim().toLowerCase()
      if (!existingIds.has(mark.studentId) && (!normalizedStudentNumber || !existingStudentNumbers.has(normalizedStudentNumber))) {
        merged.unshift({
          id: mark.studentId,
          studentNumber: mark.studentNumber,
          firstName: mark.firstName,
          lastName: mark.lastName,
          status: mark.status,
          checkedInAt: mark.checkedInAt,
          confidence: mark.confidence,
        })
      }
    }

    return merged
  }

  const computeLocalAttendanceStatus = (schedule: ScheduleInfo): { status: 'present' | 'late'; locked: boolean } => {
    const { startTime, dayOfWeek } = schedule
    if (!startTime || !dayOfWeek) {
      console.warn('⚠️ Schedule missing startTime or dayOfWeek:', { startTime, dayOfWeek })
      return { status: 'present', locked: false }
    }

    const now = new Date()
    const today = now.toLocaleDateString('en-US', { weekday: 'long' })
    
    // More robust day comparison (handle case variations)
    const dayMatch = today.toLowerCase() === dayOfWeek.toLowerCase()
    console.log(`📅 Day check: today="${today}" vs schedule="${dayOfWeek}" → match=${dayMatch}`)
    
    if (!dayMatch) {
      // Still offline mode: if offline and day doesn't match, we can't be sure
      // Log it but continue to time check anyway (in case cached data has wrong day)
      console.log(`⚠️ Day of week mismatch (${today} !== ${dayOfWeek}), but continuing with time check for offline robustness`)
    }

    // Parse start_time (e.g., "08:00:00" or "08:00" or "8:00")
    let hours: number, minutes: number
    try {
      const timeParts = startTime.split(':')
      hours = parseInt(timeParts[0], 10)
      minutes = parseInt(timeParts[1], 10)
      if (isNaN(hours) || isNaN(minutes)) throw new Error('Invalid time format')
    } catch (e) {
      console.error('❌ Failed to parse startTime:', startTime, e)
      return { status: 'present', locked: false }
    }
    
    const classStart = new Date(now)
    classStart.setHours(hours, minutes, 0, 0)

    const diffMs = now.getTime() - classStart.getTime()
    const diffMinutes = diffMs / (1000 * 60)

    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    console.log(`⏱️ Class start: ${startTime} | Current time: ${currentTimeStr} | Difference: ${diffMinutes.toFixed(1)} minutes`)

    const GRACE_PERIOD = 20
    const LOCK_THRESHOLD = 30

    if (diffMinutes < 0) {
      console.log(`✅ Before class start (${diffMinutes.toFixed(1)} min before) — marking as present`)
      return { status: 'present', locked: false }
    } else if (diffMinutes <= GRACE_PERIOD) {
      console.log(`✅ Within grace period (${diffMinutes.toFixed(1)}/${GRACE_PERIOD} min) — marking as present`)
      return { status: 'present', locked: false }
    } else if (diffMinutes <= LOCK_THRESHOLD) {
      console.log(`⚠️ Late! (${diffMinutes.toFixed(1)}/${LOCK_THRESHOLD} min) — marking as late`)
      return { status: 'late', locked: false }
    } else {
      console.log(`🔒 Locked! (${diffMinutes.toFixed(1)} > ${LOCK_THRESHOLD} min) — no more marking allowed`)
      return { status: 'late', locked: true }
    }
  }

  const splitDisplayName = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return { firstName: 'Unknown', lastName: 'Student' }
    if (parts.length === 1) return { firstName: parts[0], lastName: '' }
    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: parts[parts.length - 1],
    }
  }

  const buildOfflineRosterFromEncodings = (students: any[]): EnrolledStudent[] => {
    return students.map((s: any) => {
      const { firstName, lastName } = splitDisplayName(String(s.name || '').trim())
      return {
        id: String(s.id),
        studentNumber: String(s.student_number || ''),
        firstName,
        lastName,
        status: 'pending',
        checkedInAt: null,
        confidence: null,
      }
    })
  }

  const computeStatsFromStudents = (students: EnrolledStudent[]) => {
    const present = students.filter(s => s.status === 'present').length
    const late = students.filter(s => s.status === 'late').length
    const absent = students.filter(s => s.status === 'absent').length
    const pending = students.filter(s => s.status === 'pending').length
    return { present, late, absent, pending, total: students.length }
  }

  const queueAttendanceMark = (payload: Omit<AttendanceMarkQueueItem, 'id' | 'queuedAt'>) => {
    const items = loadQueue()
    // Avoid duplicates per day/section/student as best-effort
    const today = new Date().toISOString().split('T')[0]
    const normalizedPayloadNumber = String(payload.studentNumber || '').trim().toLowerCase()
    const exists = items.some(i => {
      if (!(i.sectionId === payload.sectionId && i.queuedAt.startsWith(today))) return false
      if (i.studentId === payload.studentId) return true
      const normalizedQueuedNumber = String(i.studentNumber || '').trim().toLowerCase()
      return !!normalizedPayloadNumber && normalizedQueuedNumber === normalizedPayloadNumber
    })
    if (exists) {
      setQueuedMarksCount(items.length)
      return
    }
    const next: AttendanceMarkQueueItem = {
      id: `${payload.sectionId}:${payload.studentNumber || payload.studentId}:${Date.now()}`,
      ...payload,
      queuedAt: new Date().toISOString(),
    }
    items.push(next)
    saveQueue(items)
  }

  const flushAttendanceQueue = async () => {
    if (!navigator.onLine) {
      setSystemOffline(true)
      return
    }

    const items = loadQueue()
    if (items.length === 0) {
      setQueuedMarksCount(0)
      return
    }

    // Process sequentially to avoid flooding and to preserve ordering.
    const remaining: AttendanceMarkQueueItem[] = []
    for (const item of items) {
      try {
        const res = await fetch('/api/attendance/mark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionId: item.sectionId,
            studentId: item.studentId,
            studentNumber: item.studentNumber,
            faceMatchConfidence: item.faceMatchConfidence,
            scheduleId: item.scheduleId,
          }),
        })

        const data = await res.json().catch(() => ({} as any))

        // If we got a response at all, the system is reachable.
        setSystemOffline(false)

        if (data?.locked) {
          // Locked sessions won't accept marks; drop the item to avoid retry loops.
          continue
        }

        if (data?.success || data?.alreadyMarked) {
          continue
        }

        // Unexpected response: keep it for retry.
        remaining.push(item)
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          setSystemOffline(true)
        }
        remaining.push(item)
      }
    }

    saveQueue(remaining)
    setQueuedMarksCount(remaining.length)
    
    // Refresh student list to show newly marked students from server
    if (remaining.length < items.length) {
      // Some items were successfully flushed, refresh the roster after a brief delay
      // to ensure the server has fully processed and indexed the new marks
      setTimeout(() => refreshStudentList(), 500)
    }
  }

  const saveEncodingsCache = (sectionId: string, students: any[]) => {
    try {
      localStorage.setItem(
        encodingsCacheKey(sectionId),
        JSON.stringify({ students, savedAt: Date.now() })
      )
    } catch {
      // Ignore quota / storage failures
    }
  }

  const loadEncodingsCache = (sectionId: string): any[] | null => {
    try {
      const raw = localStorage.getItem(encodingsCacheKey(sectionId))
      if (!raw) return null
      const parsed = JSON.parse(raw) as { students?: any[] }
      if (!parsed?.students || !Array.isArray(parsed.students)) return null
      return parsed.students
    } catch {
      return null
    }
  }

  // Restore persisted session on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as {
        phase: KioskPhase
        professor: ProfessorInfo
        selectedSchedule: ScheduleInfo
        attendanceLocked: boolean
        savedAt: number
      }
      // Ignore sessions older than 4 hours
      if (Date.now() - saved.savedAt > 4 * 60 * 60 * 1000) {
        sessionStorage.removeItem(SESSION_KEY)
        return
      }
      if (!saved.professor || !saved.selectedSchedule) return
      setProfessor(saved.professor)
      setSelectedSchedule(saved.selectedSchedule)
      if (saved.attendanceLocked) setAttendanceLocked(true)
      setPhase(saved.phase)
      // Prevent double-marking absent on restore
      hasMarkedAbsentRef.current = saved.attendanceLocked || saved.phase === 'attendance-locked'
      // Reload face encodings into Python server session cache (best-effort)
      if (saved.phase === 'attendance-active') {
        fetch(`/api/attendance/section-encodings?sectionId=${saved.selectedSchedule.sectionId}`)
          .then(r => r.json())
          .then(data => {
            if (data.success && data.students?.length > 0) {
              saveEncodingsCache(saved.selectedSchedule.sectionId, data.students)
              loadSessionEncodings(saved.selectedSchedule.sectionId, data.students).catch(() => {})
            }
          })
          .catch(() => {
            // Offline-safe: keep running with whatever is already in memory.
            setSystemOffline(!navigator.onLine)

            // Try cached encodings so recognition still works offline.
            const cached = loadEncodingsCache(saved.selectedSchedule.sectionId)
            if (cached && cached.length > 0) {
              loadSessionEncodings(saved.selectedSchedule.sectionId, cached).catch(() => {})
              const offlineRoster = buildOfflineRosterFromEncodings(cached)
              setEnrolledStudents(offlineRoster)
              setStats(computeStatsFromStudents(offlineRoster))
            }
          })
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initialize queued marks count
  useEffect(() => {
    setQueuedMarksCount(loadQueue().length)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-flush queued marks when we regain connectivity during an active session
  useEffect(() => {
    if (systemOffline) return
    if (!selectedSchedule) return

    const interval = setInterval(() => {
      if (!navigator.onLine) {
        setSystemOffline(true)
        return
      }
      if (loadQueue().length > 0) {
        flushAttendanceQueue()
          .then(() => refreshStudentList())
          .catch(() => {})
      }
    }, 5000)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemOffline, selectedSchedule])

  // Flush immediately when browser reports we're back online
  useEffect(() => {
    const onOnline = () => {
      flushAttendanceQueue()
        .then(() => refreshStudentList())
        .catch(() => {})
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist active session so it survives tab discard / page reloads
  useEffect(() => {
    if ((phase !== 'attendance-active' && phase !== 'attendance-locked') || !professor || !selectedSchedule) return
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        phase,
        professor,
        selectedSchedule,
        attendanceLocked,
        savedAt: Date.now(),
      }))
    } catch {}
  }, [SESSION_KEY, phase, professor, selectedSchedule, attendanceLocked])

  // Inactivity — show idle overlay after 30 seconds of no activity
  useEffect(() => {
    const checkInactivity = () => {
      if (Date.now() - lastActivityRef.current >= 30000) {
        setIsIdle(true)
      }
    }
    const interval = setInterval(checkInactivity, 5000)
    return () => clearInterval(interval)
  }, [])



  // Idle carousel timers
  useEffect(() => {
    if (!isIdle) return
    const t1 = setInterval(() => setIdleAnnouncementIdx(p => (p + 1) % IDLE_ANNOUNCEMENTS.length), 6000)
    const t2 = setInterval(() => setIdleTriviaIdx(p => (p + 1) % IDLE_TRIVIA.length), 8000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [isIdle])

  // Reset activity on any user interaction
  useEffect(() => {
    const reset = () => {
      lastActivityRef.current = Date.now()
      setIsIdle(false)
    }
    window.addEventListener('mousedown', reset)
    window.addEventListener('keydown', reset)
    window.addEventListener('touchstart', reset)
    return () => {
      window.removeEventListener('mousedown', reset)
      window.removeEventListener('keydown', reset)
      window.removeEventListener('touchstart', reset)
    }
  }, [])

  // Check server health
  useEffect(() => {
    const init = async () => {
      const healthy = await checkFaceNetHealth()
      setServerHealthy(healthy)
      setModelsLoaded(true)
      if (healthy) {
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

  // Initialize persistent Image for server camera frame decoding
  useEffect(() => {
    serverCameraImgRef.current = new Image()
    return () => { serverCameraImgRef.current = null }
  }, [])

  // ============ Server Camera Frame Drawing ============

  const drawServerFrame = useCallback((data: CameraStreamFrame) => {
    const canvas = serverCameraCanvasRef.current
    const img = serverCameraImgRef.current
    if (!canvas || !img) return

    const { width, height } = data
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    img.onload = () => {
      ctx.save()
      // Mirror horizontally
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0, width, height)
      ctx.restore()
    }
    img.src = `data:image/jpeg;base64,${data.frame}`
  }, [])

  // ============ Server Camera Result Handlers ============

  const handleServerResults = useCallback((data: CameraStreamFrame) => {
    if (phase === 'professor-scan') {
      handleProfessorScanResult(data)
    } else if (phase === 'attendance-active') {
      handleAttendanceResult(data)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // rAF loop — draws the latest queued frame and routes results
  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      const frame = pendingFrameRef.current
      if (frame) {
        pendingFrameRef.current = null
        drawServerFrame(frame)
        handleServerResults(frame)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawServerFrame, handleServerResults])

  // Server camera stream — connects once, mode changes dynamically
  useEffect(() => {
    if (!serverHealthy) return

    const stream = new ServerCameraStream()
    serverStreamRef.current = stream

    const initialMode = phase === 'attendance-active' ? 'recognize' : 'extract'
    setCameraMode(initialMode)

    stream.start(
      initialMode,
      (data: CameraStreamFrame) => {
        if (!cameraConnectedRef.current) {
          cameraConnectedRef.current = true
          setCameraConnected(true)
        }
        // Throttle FPS state to once per second
        const now = performance.now()
        if (now - lastFpsUpdateRef.current > 1000) {
          lastFpsUpdateRef.current = now
          setCameraFps(data.fps)
        }
        // Queue frame for rAF rendering
        pendingFrameRef.current = data
      },
      (errMsg: string) => {
        setCameraConnected(false)
        cameraConnectedRef.current = false
        console.warn('Server camera error:', errMsg)
      },
      60
    )

    return () => {
      stream.stop()
      serverStreamRef.current = null
      setCameraConnected(false)
      cameraConnectedRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverHealthy])

  // Switch camera mode when phase changes
  useEffect(() => {
    const newMode: CameraStreamMode = phase === 'attendance-active' ? 'recognize' : 'extract'
    if (newMode !== cameraMode) {
      setCameraMode(newMode)
      serverStreamRef.current?.setMode(newMode)
    }
  }, [phase, cameraMode])

  // Phase 1: Handle extract results for professor identification
  const handleProfessorScanResult = useCallback(async (data: CameraStreamFrame) => {
    const result = data.results as FaceNetEmbedding | null
    if (!result) return

    // Respect cooldown
    if (Date.now() < scanCooldownUntilRef.current) return

    if (result.detected && result.box) {
      // Face is present in this frame — keep the kiosk awake
      lastActivityRef.current = Date.now()
      setFaceDetected(true)
      setSpoofDetected(!!(result.spoofDetected ?? result.spoof_detected))
      // Use the box from the server for bounding box overlay
      const box = result.box as { x?: number; y?: number; width?: number; height?: number; left?: number; top?: number; right?: number; bottom?: number }
      const bx = box.x ?? box.left ?? 0
      const by = box.y ?? box.top ?? 0
      const bw = box.width ?? ((box.right ?? 0) - bx)
      const bh = box.height ?? ((box.bottom ?? 0) - by)
      const pad = 40
      const side = Math.max(bw, bh) + pad * 2
      setBoundingBox({
        x: Math.max(0, bx + bw / 2 - side / 2),
        y: Math.max(0, by + bh / 2 - side / 2),
        width: side,
        height: side,
      })
    } else {
      setFaceDetected(false)
      setSpoofDetected(false)
      setBoundingBox(null)
      if (professorScanStatus === 'scanning') setProfessorScanStatus('idle')
      return
    }

    if (!result.embedding || isMatchingRef.current) return

    // Anti-spoof gate
    if (result.spoofDetected ?? result.spoof_detected) return

    isMatchingRef.current = true
    setProfessorScanStatus('scanning')

    try {
      const res = await fetch('/api/professor/face-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faceDescriptor: result.embedding })
      })
      const matchData = await res.json()

      if (matchData.matched && matchData.professor) {
        setSystemOffline(false)
        setProfessorScanStatus('matched')
        const prof: ProfessorInfo = {
          id: matchData.professor.id,
          firstName: matchData.professor.firstName,
          lastName: matchData.professor.lastName,
          email: matchData.professor.email,
          role: matchData.professor.role,
          employeeId: matchData.professor.employeeId
        }
        setProfessor(prof)
        playSound('success')

        const schedRes = await fetch(`/api/kiosk/professor-schedule?professorId=${prof.id}`)
        const schedData = await schedRes.json()

        if (schedData.success && schedData.schedules.length > 0) {
          setSystemOffline(false)
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
      if (isLikelyNetworkError(err)) setSystemOffline(true)
      setProfessorScanStatus('idle')
      isMatchingRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professorScanStatus])

  // Phase 3: Handle recognize results for attendance marking
  const handleAttendanceResult = useCallback((data: CameraStreamFrame) => {
    const result = data.results as RecognitionResult | null
    if (!result || !selectedSchedule || attendanceLocked) return

    // Extra guardrail: require a minimum confidence before we persist attendance.
    // This protects against misconfigured backend thresholds or transient false matches.
    const MIN_MARK_CONFIDENCE = 0.6

    if (!result.detected || !result.faces || result.faces.length === 0) {
      setDetectedFaces([])
      setFaceMatchResults([])
      setScanStatus('idle')
      return
    }

    // Faces present in this frame — keep the kiosk awake
    lastActivityRef.current = Date.now()

    setDetectedFaces(result.faces.map(f => ({
      index: f.index,
      embedding: [],
      embedding_size: 0,
      box: f.box
    })))

    const uiResults: Array<{ box: DetectedFace['box']; name: string; status: 'matched' | 'no-match' | 'already-marked' }> = []

    for (const face of result.faces) {
      const allowOfflineSpoofFallback = !!systemOffline && !!face.spoofDetected && (typeof face.confidence === 'number' && face.confidence >= 0.92)
      if (
        face.matched &&
        typeof face.studentId === 'string' &&
        !!face.studentId &&
        (!face.spoofDetected || allowOfflineSpoofFallback) &&
        (typeof face.confidence === 'number' && face.confidence >= MIN_MARK_CONFIDENCE)
      ) {
        if (allowOfflineSpoofFallback) {
          console.warn('⚠️ Offline spoof fallback: allowing high-confidence match despite spoof flag', {
            studentId: face.studentId,
            confidence: face.confidence,
          })
        }
        const studentId = face.studentId
        const normalizedStudentNumber = String(face.studentNumber || '').trim().toLowerCase()

        if (markedStudentIdsRef.current.has(studentId) || (!!normalizedStudentNumber && markedStudentNumbersRef.current.has(normalizedStudentNumber))) {
          uiResults.push({ box: face.box, name: face.name, status: 'already-marked' })

          // Check if student is in the current section's enrolled list
          setEnrolledStudents(prev => {
            const index = prev.findIndex(s => s.id === studentId || (normalizedStudentNumber && String(s.studentNumber || '').trim().toLowerCase() === normalizedStudentNumber))
            if (index >= 0) {
              // Student already in roster — keep their marked status, don't update
              return prev
            } else {
              // Student not in current section's roster — don't add them
              // This prevents marking students from other sections due to false face matches
              return prev
            }
          })
        } else {
          uiResults.push({ box: face.box, name: face.name, status: 'matched' })

          if (!markingStudentIdsRef.current.has(studentId)) {
            markingStudentIdsRef.current.add(studentId)

            fetch('/api/attendance/mark', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sectionId: selectedSchedule.sectionId,
                studentId,
                faceMatchConfidence: face.confidence,
                scheduleId: selectedSchedule.id,
                scheduleStartTime: selectedSchedule.startTime,
                scheduleDayOfWeek: selectedSchedule.dayOfWeek,
              })
            }).then(async res => {
              const markData = await res.json()
              if (markData.alreadyMarked) {
                setSystemOffline(false)
                markedStudentIdsRef.current.add(studentId)
                if (normalizedStudentNumber) markedStudentNumbersRef.current.add(normalizedStudentNumber)
                const recStatus = markData.record?.status === 'late' ? 'late' : 'present'
                const nowIso = markData.record?.checked_in_at || new Date().toISOString()
                const { firstName, lastName } = splitDisplayName(face.name || 'Unknown Student')
                upsertLocalMark(selectedSchedule.sectionId, {
                  studentId,
                  studentNumber: face.studentNumber || '',
                  firstName,
                  lastName,
                  status: recStatus,
                  checkedInAt: nowIso,
                  confidence: face.confidence ?? null,
                })
                setEnrolledStudents(prev => {
                  const index = prev.findIndex(s => s.id === studentId || (normalizedStudentNumber && String(s.studentNumber || '').trim().toLowerCase() === normalizedStudentNumber))
                  let next: EnrolledStudent[]
                  if (index >= 0) {
                    next = prev.map((s, i) => (
                      i === index
                        ? { ...s, status: recStatus, checkedInAt: nowIso, confidence: face.confidence ?? null }
                        : s
                    ))
                  } else {
                    next = [
                      {
                        id: studentId,
                        studentNumber: face.studentNumber || '',
                        firstName,
                        lastName,
                        status: recStatus,
                        checkedInAt: nowIso,
                        confidence: face.confidence ?? null,
                      },
                      ...prev,
                    ]
                  }
                  setStats(computeStatsFromStudents(next))
                  return next
                })
                markingStudentIdsRef.current.delete(studentId)
              } else if (markData.locked) {
                setSystemOffline(false)
                setAttendanceLocked(true)
                setPhase('attendance-locked')
                markingStudentIdsRef.current.delete(studentId)
              } else if (markData.success) {
                setSystemOffline(false)
                markedStudentIdsRef.current.add(studentId)
                if (normalizedStudentNumber) markedStudentNumbersRef.current.add(normalizedStudentNumber)
                markingStudentIdsRef.current.delete(studentId)
                const recStatus = markData.record?.status || 'present'
                const nowIso = markData.record?.checked_in_at || new Date().toISOString()
                const { firstName, lastName } = splitDisplayName(face.name || 'Unknown Student')
                upsertLocalMark(selectedSchedule.sectionId, {
                  studentId,
                  studentNumber: face.studentNumber || '',
                  firstName,
                  lastName,
                  status: recStatus === 'late' ? 'late' : 'present',
                  checkedInAt: nowIso,
                  confidence: face.confidence ?? null,
                })
                playSound(recStatus === 'late' ? 'late' : 'success')
                refreshStudentList()
              } else {
                // API returned an error or unexpected response
                console.warn('⚠️ Failed to mark attendance:', markData.error || 'Unknown error')
                // Do not mark the student — API rejected them (likely not in this section or other validation)
                markingStudentIdsRef.current.delete(studentId)
              }
            }).catch(() => {
              // Offline-safe: queue the mark and update UI immediately.
              setSystemOffline(true)

              try {
                queueAttendanceMark({
                  sectionId: selectedSchedule.sectionId,
                  studentId,
                  studentNumber: face.studentNumber || undefined,
                  faceMatchConfidence: face.confidence ?? undefined,
                  scheduleId: selectedSchedule.id,
                })
              } catch {}

              const { status, locked } = computeLocalAttendanceStatus(selectedSchedule)
              if (locked) {
                setAttendanceLocked(true)
                setPhase('attendance-locked')
              } else {
                // Only mark student if they are in the enrolled roster for this section
                // This prevents false marks from students in other sections
                setEnrolledStudents(prev => {
                  const index = prev.findIndex(s => s.id === studentId || (normalizedStudentNumber && String(s.studentNumber || '').trim().toLowerCase() === normalizedStudentNumber))
                  
                  // Student must be in the current section's enrolled list
                  if (index < 0) {
                    console.warn('⚠️ Face matched but student not enrolled in this section:', studentId)
                    // Do not add them; they're likely from another section
                    return prev
                  }

                  markedStudentIdsRef.current.add(studentId)
                  if (normalizedStudentNumber) markedStudentNumbersRef.current.add(normalizedStudentNumber)
                  const nowIso = new Date().toISOString()
                  const { firstName, lastName } = splitDisplayName(face.name || 'Unknown Student')
                  upsertLocalMark(selectedSchedule.sectionId, {
                    studentId,
                    studentNumber: face.studentNumber || '',
                    firstName,
                    lastName,
                    status,
                    checkedInAt: nowIso,
                    confidence: face.confidence ?? null,
                  })

                  const next = prev.map((s, i) => (
                    i === index
                      ? { ...s, status, checkedInAt: nowIso, confidence: face.confidence ?? null }
                      : s
                  ))

                  setStats(computeStatsFromStudents(next))
                  playSound(status === 'late' ? 'late' : 'success')
                  return next
                })
              }
              markingStudentIdsRef.current.delete(studentId)
            })
          }
        }
      } else {
        uiResults.push({ box: face.box, name: 'Unknown', status: 'no-match' })
      }
    }

    setFaceMatchResults(uiResults)

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchedule, attendanceLocked])

  // ============ Phase 2: Schedule Select ============

  // Periodically refresh schedules to pick up newly created classrooms
  useEffect(() => {
    if (phase !== 'schedule-select' || !professor) return

    const refreshSchedules = async () => {
      try {
        const res = await fetch(`/api/kiosk/professor-schedule?professorId=${professor.id}`)
        const data = await res.json()
        if (data.success && Array.isArray(data.schedules)) {
          setSchedules(data.schedules)
          
          // Pre-fetch face encodings for all schedules so they're cached before going offline
          data.schedules.forEach((schedule: ScheduleInfo) => {
            if (!loadEncodingsCache(schedule.sectionId)) {
              // Only fetch if not already cached
              fetch(`/api/attendance/section-encodings?sectionId=${schedule.sectionId}`)
                .then(res => res.json())
                .then(data => {
                  if (data.success && data.students?.length > 0) {
                    saveEncodingsCache(schedule.sectionId, data.students)
                    console.log(`📚 Pre-cached ${data.students.length} encodings for section ${schedule.sectionId}`)
                  }
                })
                .catch(err => console.warn(`⚠️ Failed to pre-cache encodings for section ${schedule.sectionId}:`, err))
            }
          })
        }
      } catch (err) {
        console.warn('Failed to refresh schedules:', err)
      }
    }

    // Refresh immediately, then every 30 seconds to pick up newly created classrooms
    refreshSchedules()
    const interval = setInterval(refreshSchedules, 30000)
    return () => clearInterval(interval)
  }, [phase, professor])

  // Pre-load all offline cache data to browser on mount to ensure it's available when offline
  useEffect(() => {
    const preloadOfflineCache = async () => {
      try {
        // Fetch all offline cache data for this professor's classrooms
        const res = await fetch(`/api/attendance/preload-offline-cache`)
        if (!res.ok) return
        
        const data = await res.json()
        if (data.success && data.students && Array.isArray(data.students)) {
          // Group students by section and cache each section's encodings
          const sections = new Map<string, any[]>()
          data.students.forEach((student: any) => {
            if (student.sectionId) {
              if (!sections.has(student.sectionId)) {
                sections.set(student.sectionId, [])
              }
              if (student.faceDescriptor && Array.isArray(student.faceDescriptor)) {
                sections.get(student.sectionId)!.push({
                  id: student.id,
                  name: `${student.firstName} ${student.lastName}`.trim(),
                  student_number: student.studentNumber,
                  embedding: student.faceDescriptor,
                })
              }
            }
          })
          
          // Cache each section's encodings to localStorage
          sections.forEach((students, sectionId) => {
            if (students.length > 0 && !loadEncodingsCache(sectionId)) {
              saveEncodingsCache(sectionId, students)
              console.log(`📦 Pre-loaded ${students.length} face encodings for section ${sectionId} from offline cache`)
            }
          })
        }
      } catch (err) {
        console.warn('⚠️ Failed to pre-load offline cache:', err)
        // Not critical - will fall back to on-demand loading
      }
    }

    // Run on page load
    preloadOfflineCache()
  }, [])

  const selectSchedule = useCallback(async (schedule: ScheduleInfo) => {
    console.log('📋 Starting selectSchedule for:', schedule.sectionCode)
    console.log('📋 Schedule details:', {
      id: schedule.id,
      sectionCode: schedule.sectionCode,
      room: schedule.room,
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      totalStudents: schedule.totalStudents,
    })
    setSelectedSchedule(schedule)
    hasMarkedAbsentRef.current = false
    isMatchingRef.current = false
    markedStudentIdsRef.current = new Set()
    markedStudentNumbersRef.current = new Set()
    markingStudentIdsRef.current = new Set()

    let hasLoadedEncodings = false

    // Load enrolled face encodings into Python server session cache
    try {
      const res = await fetch(`/api/attendance/section-encodings?sectionId=${schedule.sectionId}`)
      const data = await res.json()
      if (data.success && data.students?.length > 0) {
        setSystemOffline(false)
        // Always update the cache with fresh data from server/offline-cache
        saveEncodingsCache(schedule.sectionId, data.students)
        const preloadedRoster = buildOfflineRosterFromEncodings(data.students)
        const mergedRoster = applyLocalMarksToRoster(schedule.sectionId, preloadedRoster)
        setEnrolledStudents(mergedRoster)
        setStats(computeStatsFromStudents(mergedRoster))
        await loadSessionEncodings(schedule.sectionId, data.students)
        console.log(`\u{1F4DA} Session loaded: ${data.students.length} students with face descriptors`)
        hasLoadedEncodings = true
      } else {
        // API returned no students, but we're still online - try cache as fallback
        console.warn('⚠️ API returned no students for section:', schedule.sectionId)
      }
    } catch (err) {
      console.warn('❌ Failed to fetch from API:', err)
      if (isLikelyNetworkError(err)) {
        setSystemOffline(true)
        console.log('📴 Switched to offline mode')
      }
    }

    // Offline or no results: load cached encodings so recognition can continue
    if (!hasLoadedEncodings) {
      console.log('🔄 Attempting to load cached encodings for section:', schedule.sectionId)
      
      // Try browser localStorage first (fastest, works fully offline)
      const cached = loadEncodingsCache(schedule.sectionId)
      if (cached && cached.length > 0) {
        console.log(`✅ Found ${cached.length} encodings in browser cache`)
        try {
          const offlineRoster = buildOfflineRosterFromEncodings(cached)
          const mergedRoster = applyLocalMarksToRoster(schedule.sectionId, offlineRoster)
          setEnrolledStudents(mergedRoster)
          setStats(computeStatsFromStudents(mergedRoster))
          await loadSessionEncodings(schedule.sectionId, cached)
          console.log(`\u{1F4DA} Session loaded from browser cache: ${cached.length} students`)
          hasLoadedEncodings = true
        } catch (loadErr) {
          console.warn('⚠️ Failed to load session from browser cache:', loadErr)
        }
      } else {
        console.warn('⚠️ No cached face encodings found in browser storage for section:', schedule.sectionId)
        console.warn('💡 TIP: Face encodings should be pre-cached on page load. If offline, try going online and reopening the kiosk.')
        // Still proceed with empty roster - at least the attendance page will load
        setEnrolledStudents([])
        setStats({ presentCount: 0, lateCount: 0, absentCount: schedule.totalStudents })
      }
    }

    // Best-effort: try to sync any queued marks immediately when starting.
    flushAttendanceQueue().catch(() => {})

    console.log('✅ Transitioning to attendance-active phase')
    setPhase('attendance-active')
  }, [])

  // ============ Phase 3: Attendance Scanning ============

  // Periodically refresh face encodings to pick up newly registered students
  useEffect(() => {
    if ((phase !== 'attendance-active' && phase !== 'attendance-locked') || !selectedSchedule) return

    const refreshFaceEncodings = async () => {
      try {
        console.log('🔄 Refreshing face encodings for section:', selectedSchedule.sectionId)
        const res = await fetch(`/api/attendance/section-encodings?sectionId=${selectedSchedule.sectionId}`)
        const data = await res.json()
        
        if (data.success && data.students?.length > 0) {
          setSystemOffline(false)
          // Update cache with fresh encodings
          saveEncodingsCache(selectedSchedule.sectionId, data.students)
          // Reload into Python server session
          try {
            await loadSessionEncodings(selectedSchedule.sectionId, data.students)
            console.log(`✅ Face encodings refreshed: ${data.students.length} students`)
          } catch (loadErr) {
            console.warn('⚠️ Failed to load session encodings:', loadErr)
          }
        }
      } catch (err) {
        console.warn('Failed to refresh face encodings:', err)
        if (isLikelyNetworkError(err)) {
          setSystemOffline(true)
          // Fallback to offline cache
          const cached = loadEncodingsCache(selectedSchedule.sectionId)
          if (cached && cached.length > 0) {
            try {
              await loadSessionEncodings(selectedSchedule.sectionId, cached)
              console.log(`✅ Face encodings reloaded from offline cache: ${cached.length} students`)
            } catch {}
          }
        }
      }
    }

    // Refresh face encodings every 10 seconds to pick up newly registered students
    const interval = setInterval(refreshFaceEncodings, 10000)
    
    return () => clearInterval(interval)
  }, [phase, selectedSchedule])

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
          setSystemOffline(false)
          const mergedStudents = applyLocalMarksToRoster(selectedSchedule.sectionId, data.students)
          const mergedStats = computeStatsFromStudents(mergedStudents)
          setEnrolledStudents(mergedStudents)
          setStats(mergedStats)
          try {
            sessionStorage.setItem(rosterCacheKey(selectedSchedule.sectionId), JSON.stringify({
              students: mergedStudents,
              stats: mergedStats,
              savedAt: Date.now(),
            }))
          } catch {}
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Failed to fetch students:', err)
          if (isLikelyNetworkError(err)) {
            setSystemOffline(true)
            // Use cached roster if available
            try {
              const raw = sessionStorage.getItem(rosterCacheKey(selectedSchedule.sectionId))
              if (raw) {
                const cached = JSON.parse(raw) as { students: EnrolledStudent[]; stats: any }
                if (cached?.students?.length) {
                  const mergedStudents = applyLocalMarksToRoster(selectedSchedule.sectionId, cached.students)
                  setEnrolledStudents(mergedStudents)
                  setStats(computeStatsFromStudents(mergedStudents))
                }
              }
            } catch {}
          }
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

  // ============ Helpers ============

  const refreshStudentList = async () => {
    if (!selectedSchedule) return
    try {
      const res = await fetch(`/api/attendance/enrolled-students?sectionId=${selectedSchedule.sectionId}`)
      const data = await res.json()
      if (data.success) {
        setSystemOffline(false)
        const mergedStudents = applyLocalMarksToRoster(selectedSchedule.sectionId, data.students)
        const mergedStats = computeStatsFromStudents(mergedStudents)
        setEnrolledStudents(mergedStudents)
        setStats(mergedStats)
        try {
          sessionStorage.setItem(rosterCacheKey(selectedSchedule.sectionId), JSON.stringify({
            students: mergedStudents,
            stats: mergedStats,
            savedAt: Date.now(),
          }))
        } catch {}
      }
    } catch (err) {
      if (isLikelyNetworkError(err)) setSystemOffline(true)
    }
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
      if (isLikelyNetworkError(err)) setSystemOffline(true)

      // Offline fallback: once locked, mark remaining pending students as absent locally.
      setEnrolledStudents(prev => {
        const next = prev.map(s => (s.status === 'pending' ? { ...s, status: 'absent' as const } : s))
        setStats(computeStatsFromStudents(next))
        return next
      })
    }
  }

  const resetToScan = () => {
    try { sessionStorage.removeItem(SESSION_KEY) } catch {}
    if (selectedSchedule?.sectionId) {
      try { sessionStorage.removeItem(localMarksCacheKey(selectedSchedule.sectionId)) } catch {}
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
    setSpoofDetected(false)
    setBoundingBox(null)
    setDetectedFaces([])
    setFaceMatchResults([])
    isMatchingRef.current = false
    // 4-second cooldown so the professor isn't instantly re-detected after reset
    scanCooldownUntilRef.current = Date.now() + 4000
    hasMarkedAbsentRef.current = false
    markedStudentIdsRef.current = new Set()
    markedStudentNumbersRef.current = new Set()
    markingStudentIdsRef.current = new Set()
    // Switch back to extract mode for professor scan
    setCameraMode('extract')
    serverStreamRef.current?.setMode('extract')
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
    if (phase !== 'professor-scan' || !professorOverlayRef.current || !serverCameraCanvasRef.current) return

    const canvas = professorOverlayRef.current
    const source = serverCameraCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number

    const drawFrame = () => {
      canvas.width = source.width || 560
      canvas.height = source.height || 420
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
    if ((phase !== 'attendance-active' && phase !== 'attendance-locked') || !attendanceCanvasRef.current || !serverCameraCanvasRef.current) return

    const canvas = attendanceCanvasRef.current
    const source = serverCameraCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // When locked, clear the canvas once and stop — no more animated boxes
    if (phase === 'attendance-locked') {
      canvas.width = source.width || canvas.width
      canvas.height = source.height || canvas.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    let animationId: number

    const drawFrame = () => {
      canvas.width = source.width || 560
      canvas.height = source.height || 420
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw boxes for match results (colored by status)
      if (faceMatchResults.length > 0) {
        for (const result of faceMatchResults) {
          const { box, name, status } = result
          const color = status === 'matched' ? '#10b981' :
                        status === 'already-marked' ? '#3b82f6' :
                        '#ef4444'

          // Mirror X because drawServerFrame flips pixels horizontally
          const x = canvas.width - box.left - box.width
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
                            '\u26A0 Spoof Detected'
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
          const x = canvas.width - face.box.left - face.box.width
          ctx.strokeStyle = '#eab308'
          ctx.lineWidth = 2
          ctx.setLineDash([8, 4])
          ctx.strokeRect(x, face.box.top, face.box.width, face.box.height)
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

  // --- Idle Overlay ---
  const idleTrivia = IDLE_TRIVIA[idleTriviaIdx]
  const idleOverlay = isIdle ? (
    <div
      className="fixed inset-0 z-50 bg-gray-50 cursor-pointer select-none overflow-hidden flex flex-col"
      onClick={() => {
        lastActivityRef.current = Date.now()
        setIsIdle(false)
      }}
    >
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <NextImage src="/verifaceqcu.jpg" alt="VeriFace" width={36} height={36} className="rounded-lg" />
            <div>
              <h1 className="text-sm font-bold tracking-tight text-gray-900">VeriFace Attendance</h1>
              <p className="text-xs text-gray-400">Quezon City University</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            <p className="text-xl font-bold font-mono tabular-nums text-gray-800 leading-tight">
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Main 3-panel grid */}
        <div className="flex-1 grid grid-cols-[1fr_0.45fr] grid-rows-[1fr_0.45fr] gap-3 p-4 min-h-0">

          {/* LEFT - Video (spans both rows) */}
          <div className="row-span-2 rounded-2xl border border-gray-200 overflow-hidden bg-gray-900 relative shadow-sm">
            <video
              ref={idleVideoRef}
              src="/idlevideo.mp4"
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-4 left-4 bg-black/40 backdrop-blur-sm rounded-lg px-3 py-1.5">
              <p className="text-white/80 text-xs font-medium tracking-wider uppercase">Now Playing</p>
            </div>
          </div>

          {/* TOP-RIGHT - Announcements */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3 shrink-0">
              <div className="bg-amber-100 p-1.5 rounded-lg">
                <Megaphone className="w-4 h-4 text-amber-600" />
              </div>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Announcements</h2>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col justify-center">
              <div className="space-y-2 overflow-y-auto pr-1">
                {IDLE_ANNOUNCEMENTS.map((a, idx) => (
                  <div
                    key={a.id}
                    className={`p-3 rounded-xl transition-all duration-500 ${
                      idx === idleAnnouncementIdx
                        ? 'bg-amber-50 border border-amber-200 scale-[1.01] shadow-sm'
                        : 'bg-gray-50 border border-gray-100 opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        a.type === 'warning' ? 'bg-amber-500' :
                        a.type === 'event' ? 'bg-blue-500' : 'bg-emerald-500'
                      }`} />
                      <div className="min-w-0">
                        <h3 className="text-gray-800 text-sm font-semibold truncate">{a.title}</h3>
                        <p className="text-gray-500 text-xs mt-0.5 line-clamp-2 leading-relaxed">{a.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-center gap-1.5 mt-3 shrink-0">
              {IDLE_ANNOUNCEMENTS.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === idleAnnouncementIdx ? 'w-5 bg-amber-500' : 'w-1.5 bg-gray-200'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* BOTTOM-RIGHT - Trivia */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3 shrink-0">
              <div className="bg-yellow-100 p-1.5 rounded-lg">
                <Lightbulb className="w-4 h-4 text-yellow-600" />
              </div>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Trivia</h2>
            </div>
            <div className="flex-1 flex flex-col justify-center">
              <p className="text-amber-600 text-sm font-semibold mb-2">{idleTrivia.question}</p>
              <p className="text-gray-600 text-sm leading-relaxed">{idleTrivia.answer}</p>
            </div>
            <div className="flex justify-center gap-1.5 mt-3 shrink-0">
              {IDLE_TRIVIA.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === idleTriviaIdx ? 'w-5 bg-yellow-500' : 'w-1.5 bg-gray-200'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Bottom hint */}
        <div className="text-center pb-3">
          <p className="text-gray-400 text-xs animate-pulse">Tap anywhere to start</p>
        </div>
      </div>
  ) : null

  // --- Shared top bar ---
  const TopBar = ({ children }: { children?: React.ReactNode }) => (
    <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shadow-sm">
      <div className="flex items-center gap-3">
        <NextImage src="/verifaceqcu.jpg" alt="VeriFace" width={40} height={40} className="rounded-lg" />
        <div>
          <h1 className="text-base font-bold tracking-tight text-gray-900">VeriFace Attendance</h1>
          {children}
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${serverHealthy ? 'bg-emerald-500' : 'bg-red-400'}`} />
            <span className="text-xs text-gray-400">{serverHealthy ? 'Online' : 'Offline'}</span>
            <span className="text-[10px] text-gray-300">Face</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${systemOffline ? 'bg-red-400' : 'bg-emerald-500'}`} />
            <span className="text-xs text-gray-400">{systemOffline ? 'Offline' : 'Online'}</span>
            <span className="text-[10px] text-gray-300">System</span>
            {queuedMarksCount > 0 && (
              <span className="text-[10px] text-amber-500 font-medium">({queuedMarksCount} queued)</span>
            )}
          </div>
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
      <div className="min-h-screen overflow-y-auto bg-gray-50 text-gray-900 flex flex-col">
        {idleOverlay}
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
              <canvas
                ref={serverCameraCanvasRef}
                className="w-full h-full object-cover"
              />
              <canvas ref={professorOverlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* Status Overlay */}
              <div className="absolute top-3 inset-x-0 flex justify-center">
                <div className={`text-white text-xs font-medium px-3 py-1.5 rounded-lg backdrop-blur-md flex items-center gap-1.5 ${
                  professorScanStatus === 'matched' ? 'bg-emerald-600/90' :
                  professorScanStatus === 'not-found' ? 'bg-red-500/90' :
                  professorScanStatus === 'scanning' ? 'bg-blue-500/90' :
                  spoofDetected ? 'bg-orange-500/90' :
                  faceDetected ? 'bg-gray-700/80' : 'bg-gray-900/60'
                }`}>
                  {professorScanStatus === 'matched' ? (
                    <><CheckCircle className="w-3.5 h-3.5" /> Professor recognized</>
                  ) : professorScanStatus === 'scanning' ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying...</>
                  ) : professorScanStatus === 'not-found' ? (
                    'Face not recognized'
                  ) : spoofDetected ? (
                    <><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Spoof Detected</>
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
      <div className="min-h-screen overflow-y-auto bg-gray-50 text-gray-900 flex flex-col">
        {idleOverlay}
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
    <div className="min-h-screen overflow-y-auto bg-gray-50 text-gray-900 flex flex-col">
      {idleOverlay}
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <NextImage src="/verifaceqcu.jpg" alt="VeriFace" width={40} height={40} className="rounded-lg" />
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
            <span className="text-[10px] text-gray-300">Face</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${systemOffline ? 'bg-red-400' : 'bg-emerald-500'}`} />
            <span className="text-xs text-gray-400">{systemOffline ? 'Offline' : 'Online'}</span>
            <span className="text-[10px] text-gray-300">System</span>
            {queuedMarksCount > 0 && (
              <span className="text-[10px] text-amber-500 font-medium">({queuedMarksCount} queued)</span>
            )}
          </div>

          <button onClick={() => setSoundEnabled(!soundEnabled)} className="text-gray-400 hover:text-gray-600 transition">
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Escape to admin/faculty login — does NOT clear kiosk session */}
          <div className="flex items-center gap-1.5 border-l border-gray-100 pl-4">
            <button
              onClick={() => router.push('/admin/login')}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:text-emerald-600 bg-gray-50 hover:bg-emerald-50 border border-gray-200 hover:border-emerald-200 rounded-lg transition-all"
            >
              <ShieldCheck className="w-3 h-3" />
              Admin
            </button>
            <button
              onClick={() => router.push('/professor/login')}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:text-emerald-600 bg-gray-50 hover:bg-emerald-50 border border-gray-200 hover:border-emerald-200 rounded-lg transition-all"
            >
              Faculty
            </button>
          </div>

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
      <div className="flex-1 min-h-0 flex">

        {/* Left: Camera Feed */}
        <div className="flex-1 overflow-hidden flex flex-col items-center justify-center p-8">
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
            <canvas
              ref={serverCameraCanvasRef}
              className="w-full h-full object-cover"
            />
            <canvas
              ref={attendanceCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
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

          {/* Student List with Pagination */}
          {(() => {
            const PAGE_SIZE = 10
            const totalPages = Math.ceil(enrolledStudents.length / PAGE_SIZE)
            const pagedStudents = enrolledStudents.slice(studentPage * PAGE_SIZE, (studentPage + 1) * PAGE_SIZE)
            return (
              <div className="flex flex-col flex-1 min-h-0">
                {/* List header + pagination controls */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 shrink-0">
                  <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                    Students ({enrolledStudents.length})
                  </h2>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setStudentPage(p => Math.max(0, p - 1))}
                        disabled={studentPage === 0}
                        className="p-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs text-gray-400 tabular-nums min-w-12 text-center">
                        {studentPage + 1} / {totalPages}
                      </span>
                      <button
                        onClick={() => setStudentPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={studentPage >= totalPages - 1}
                        className="p-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Scrollable rows */}
                <div className="flex-1 overflow-y-auto p-4">
                  {enrolledStudents.length === 0 ? (
                    <div className="text-center py-10 text-gray-300">
                      <p className="text-xs">No students enrolled</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {pagedStudents.map(student => (
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
            )
          })()}
        </div>
      </div>
    </div>
  )
}
