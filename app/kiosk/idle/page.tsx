'use client'

import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Megaphone, Lightbulb } from 'lucide-react'

interface Announcement {
  id: string
  title: string
  message: string
  type: 'info' | 'warning' | 'event'
  date: string
}

interface TriviaItem {
  id: string
  question: string
  answer: string
}

interface IdleMediaItem {
  id: string
  title: string
  media_type: 'image' | 'video'
  media_url: string
  display_order: number
}

const SAMPLE_ANNOUNCEMENTS: Announcement[] = [
  { id: '1', title: 'Final Exams Schedule', message: 'Final examinations will be held from March 15-22, 2026. Please check your respective schedules.', type: 'warning', date: '2026-03-10' },
  { id: '2', title: 'University Foundation Day', message: 'Join us in celebrating our 50th Anniversary on February 14, 2026. Activities start at 8:00 AM.', type: 'event', date: '2026-02-14' },
  { id: '3', title: 'Enrollment Advisory', message: 'Mid-year enrollment is now open. Visit the registrar office for more details.', type: 'info', date: '2026-02-09' },
  { id: '4', title: 'Library Extended Hours', message: 'The university library will extend hours until 10:00 PM during exam week.', type: 'info', date: '2026-03-10' },
  { id: '5', title: 'Sports Fest 2026', message: 'Annual Sports Festival is scheduled for February 20-21. Sign up at the PE office.', type: 'event', date: '2026-02-20' },
]

const TRIVIA_ITEMS: TriviaItem[] = [
  { id: '1', question: 'Did you know?', answer: 'QCU was established in 1994 through Republic Act 9805 and is one of the leading universities in Quezon City.' },
  { id: '2', question: 'Fun Fact', answer: 'The average human face has 43 muscles. Our face recognition system maps 478 unique landmarks to identify you!' },
  { id: '3', question: 'Tech Trivia', answer: 'FaceNet, developed by Google, can achieve 99.63% accuracy on the Labeled Faces in the Wild benchmark.' },
  { id: '4', question: 'Campus Tip', answer: 'The university library offers free access to online journals and research databases for all enrolled students.' },
  { id: '5', question: 'Did you know?', answer: 'Attendance tracking started with paper rolls in the 1800s. Today, AI-powered face recognition does it in under a second!' },
  { id: '6', question: 'Study Hack', answer: 'The Pomodoro Technique - 25 minutes of focused study followed by a 5-minute break - can boost productivity by up to 25%.' },
]

function KioskIdleInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sectionId = searchParams.get('sectionId') || ''
  const scheduleId = searchParams.get('scheduleId') || ''

  const [currentTime, setCurrentTime] = useState(new Date())
  const [announcementIdx, setAnnouncementIdx] = useState(0)
  const [triviaIdx, setTriviaIdx] = useState(0)
  const [announcements, setAnnouncements] = useState<Announcement[]>(SAMPLE_ANNOUNCEMENTS)
  const [triviaItems, setTriviaItems] = useState<TriviaItem[]>(TRIVIA_ITEMS)
  const [idleMedia, setIdleMedia] = useState<IdleMediaItem[]>([])
  const [mediaIdx, setMediaIdx] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (announcements.length === 0) return
    const t = setInterval(() => setAnnouncementIdx(p => (p + 1) % announcements.length), 6000)
    return () => clearInterval(t)
  }, [announcements])

  useEffect(() => {
    if (triviaItems.length === 0) return
    const t = setInterval(() => setTriviaIdx(p => (p + 1) % triviaItems.length), 8000)
    return () => clearInterval(t)
  }, [triviaItems])

  useEffect(() => {
    let cancelled = false

    async function fetchIdleText() {
      try {
        const response = await fetch('/api/idle-text', { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok || cancelled) return

        const fetchedAnnouncements = Array.isArray(payload.announcements) ? payload.announcements : []
        const fetchedTrivia = Array.isArray(payload.trivia) ? payload.trivia : []

        setAnnouncements(fetchedAnnouncements.length > 0 ? fetchedAnnouncements : SAMPLE_ANNOUNCEMENTS)
        setTriviaItems(fetchedTrivia.length > 0 ? fetchedTrivia : TRIVIA_ITEMS)
        setAnnouncementIdx(0)
        setTriviaIdx(0)
      } catch {
        if (!cancelled) {
          setAnnouncements(SAMPLE_ANNOUNCEMENTS)
          setTriviaItems(TRIVIA_ITEMS)
        }
      }
    }

    void fetchIdleText()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchIdleMedia() {
      try {
        const response = await fetch('/api/idle-media', { cache: 'no-store' })
        const payload = await response.json()

        if (!response.ok || cancelled) return

        const items = Array.isArray(payload.items) ? payload.items : []
        setIdleMedia(items)
      } catch {
        if (!cancelled) setIdleMedia([])
      }
    }

    void fetchIdleMedia()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (idleMedia.length <= 1) {
      setMediaIdx(0)
      return
    }

    const timer = setInterval(() => {
      setMediaIdx((prev) => (prev + 1) % idleMedia.length)
    }, 10000)

    return () => clearInterval(timer)
  }, [idleMedia])

  const handleWakeUp = useCallback(() => {
    router.push(`/kiosk?sectionId=${sectionId}&scheduleId=${scheduleId}`)
  }, [router, sectionId, scheduleId])

  const trivia = triviaItems[triviaIdx] || TRIVIA_ITEMS[0]
  const currentMedia = idleMedia[mediaIdx]
  const mediaSrc = currentMedia?.media_url || '/idlevideo.mp4'
  const isImageMedia = currentMedia?.media_type === 'image'

  return (
    <div
      className="h-screen w-screen bg-gray-50 cursor-pointer select-none overflow-hidden flex flex-col"
      onClick={handleWakeUp}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <Image src="/verifaceqcu.jpg" alt="VeriFace" width={36} height={36} className="rounded-lg" />
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
          {isImageMedia ? (
            <img
              src={mediaSrc}
              alt={currentMedia?.title || 'Idle media'}
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              key={mediaSrc}
              ref={videoRef}
              src={mediaSrc}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute bottom-4 left-4 bg-black/40 backdrop-blur-sm rounded-lg px-3 py-1.5">
            <p className="text-white/80 text-xs font-medium tracking-wider uppercase">
              {currentMedia?.title || 'Now Playing'}
            </p>
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
              {announcements.map((a, idx) => (
                <div
                  key={a.id}
                  className={`p-3 rounded-xl transition-all duration-500 ${
                    idx === announcementIdx
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
            {announcements.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === announcementIdx ? 'w-5 bg-amber-500' : 'w-1.5 bg-gray-200'
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
            <p className="text-amber-600 text-sm font-semibold mb-2">{trivia.question}</p>
            <p className="text-gray-600 text-sm leading-relaxed">{trivia.answer}</p>
          </div>

          <div className="flex justify-center gap-1.5 mt-3 shrink-0">
            {triviaItems.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === triviaIdx ? 'w-5 bg-yellow-500' : 'w-1.5 bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Bottom hint */}
      <div className="text-center pb-3">
        <p className="text-gray-400 text-xs animate-pulse">Tap anywhere to return to attendance</p>
      </div>
    </div>
  )
}

export default function KioskIdlePage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-50" />}>
      <KioskIdleInner />
    </Suspense>
  )
}
