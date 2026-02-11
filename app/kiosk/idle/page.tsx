'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Cloud, Sun, CloudRain, Snowflake, Wind, Calendar, Bell, BarChart3, Clock, Users, Zap, GraduationCap, TrendingUp, Megaphone } from 'lucide-react'

interface Announcement {
  id: string
  title: string
  message: string
  type: 'info' | 'warning' | 'event'
  date: string
}

const SAMPLE_ANNOUNCEMENTS: Announcement[] = [
  {
    id: '1',
    title: 'Final Exams Schedule',
    message: 'Final examinations will be held from March 15-22, 2026. Please check your respective schedules.',
    type: 'warning',
    date: '2026-02-09'
  },
  {
    id: '2',
    title: 'University Foundation Day',
    message: 'Join us in celebrating our 50th Anniversary on February 14, 2026. Activities start at 8:00 AM.',
    type: 'event',
    date: '2026-02-14'
  },
  {
    id: '3',
    title: 'Enrollment Advisory',
    message: 'Mid-year enrollment is now open. Visit the registrar office for more details.',
    type: 'info',
    date: '2026-02-09'
  },
  {
    id: '4',
    title: 'Library Extended Hours',
    message: 'The university library will extend hours until 10:00 PM during exam week.',
    type: 'info',
    date: '2026-03-10'
  },
  {
    id: '5',
    title: 'Sports Fest 2026',
    message: 'Annual Sports Festival is scheduled for February 20-21. Sign up at the PE office.',
    type: 'event',
    date: '2026-02-20'
  }
]

const CALENDAR_EVENTS = [
  { date: '2026-02-14', title: 'Foundation Day', color: 'bg-purple-500' },
  { date: '2026-02-20', title: 'Sports Fest', color: 'bg-blue-500' },
  { date: '2026-03-01', title: 'Midterms Begin', color: 'bg-red-500' },
  { date: '2026-03-15', title: 'Final Exams', color: 'bg-orange-500' },
  { date: '2026-03-22', title: 'Semester End', color: 'bg-green-500' },
]

export default function IdleDisplayPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sectionId = searchParams.get('sectionId') || ''
  const scheduleId = searchParams.get('scheduleId') || ''

  const [currentTime, setCurrentTime] = useState(new Date())
  const [currentSlide, setCurrentSlide] = useState(0)
  const [weather, setWeather] = useState({ temp: 28, condition: 'Partly Cloudy', humidity: 72 })
  const [attendanceStats, setAttendanceStats] = useState({ present: 0, late: 0, absent: 0, total: 0 })
  const [activeAnnouncementIndex, setActiveAnnouncementIndex] = useState(0)

  const totalSlides = 4 // Announcements, Calendar, Analytics, Weather/Tips

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Auto-advance slides
  useEffect(() => {
    const slideTimer = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % totalSlides)
    }, 8000)
    return () => clearInterval(slideTimer)
  }, [])

  // Rotate announcements
  useEffect(() => {
    const announcementTimer = setInterval(() => {
      setActiveAnnouncementIndex(prev => (prev + 1) % SAMPLE_ANNOUNCEMENTS.length)
    }, 5000)
    return () => clearInterval(announcementTimer)
  }, [])

  // Fetch attendance stats
  useEffect(() => {
    if (!sectionId) return
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/attendance/today-stats?sectionId=${sectionId}`)
        const data = await res.json()
        if (data.success) {
          setAttendanceStats({
            present: data.present || 0,
            late: data.late || 0,
            absent: data.absent || 0,
            total: data.total || 0
          })
        }
      } catch {}
    }
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [sectionId])

  // Wake up on touch/click/motion
  const handleWakeUp = useCallback(() => {
    router.push(`/kiosk?sectionId=${sectionId}&scheduleId=${scheduleId}`)
  }, [router, sectionId, scheduleId])

  const getWeatherIcon = () => {
    const condition = weather.condition.toLowerCase()
    if (condition.includes('rain')) return <CloudRain className="w-12 h-12" />
    if (condition.includes('snow')) return <Snowflake className="w-12 h-12" />
    if (condition.includes('cloud')) return <Cloud className="w-12 h-12" />
    if (condition.includes('wind')) return <Wind className="w-12 h-12" />
    return <Sun className="w-12 h-12" />
  }

  const getGreeting = () => {
    const hour = currentTime.getHours()
    if (hour < 12) return 'Good Morning'
    if (hour < 17) return 'Good Afternoon'
    return 'Good Evening'
  }

  return (
    <div 
      className="min-h-screen bg-linear-to-br from-gray-950 via-gray-900 to-gray-950 text-white cursor-pointer select-none overflow-hidden"
      onClick={handleWakeUp}
    >
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] animate-blob" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] animate-blob animation-delay-2000" />
        <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-violet-500/10 rounded-full blur-[120px] animate-blob animation-delay-4000" />
      </div>

      {/* Top Bar */}
      <div className="flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="bg-primary/20 p-2.5 rounded-xl">
            <Zap className="w-6 h-6 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight">VeriFace</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>System Active</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-160px)] px-8">
        {/* Clock & Greeting */}
        <div className="text-center mb-12">
          <p className="text-2xl text-gray-400 font-light mb-2">{getGreeting()}</p>
          <p className="text-8xl font-bold font-mono tabular-nums tracking-tight">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-xl text-gray-500 mt-3">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

        {/* Slide Content */}
        <div className="w-full max-w-5xl">
          {/* Slide 0: Announcements */}
          {currentSlide === 0 && (
            <div className="animate-in fade-in slide-in-from-right duration-500">
              <div className="flex items-center gap-3 mb-6">
                <Megaphone className="w-6 h-6 text-yellow-400" />
                <h2 className="text-xl font-semibold text-gray-300">Announcements</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SAMPLE_ANNOUNCEMENTS.map((ann, idx) => (
                  <div
                    key={ann.id}
                    className={`p-5 rounded-2xl border backdrop-blur-sm transition-all duration-500 ${
                      idx === activeAnnouncementIndex
                        ? 'border-primary/50 bg-primary/10 scale-[1.02] shadow-xl shadow-primary/10'
                        : 'border-gray-800 bg-gray-900/50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                        ann.type === 'warning' ? 'bg-yellow-400' :
                        ann.type === 'event' ? 'bg-blue-400' : 'bg-green-400'
                      }`} />
                      <div>
                        <h3 className="font-semibold text-white text-sm">{ann.title}</h3>
                        <p className="text-xs text-gray-400 mt-1 leading-relaxed">{ann.message}</p>
                        <p className="text-xs text-gray-600 mt-2">{new Date(ann.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Slide 1: Calendar */}
          {currentSlide === 1 && (
            <div className="animate-in fade-in slide-in-from-right duration-500">
              <div className="flex items-center gap-3 mb-6">
                <Calendar className="w-6 h-6 text-blue-400" />
                <h2 className="text-xl font-semibold text-gray-300">Upcoming Events</h2>
              </div>
              <div className="space-y-3">
                {CALENDAR_EVENTS.map((event, idx) => {
                  const eventDate = new Date(event.date)
                  const daysUntil = Math.ceil((eventDate.getTime() - currentTime.getTime()) / (1000 * 60 * 60 * 24))
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-4 p-4 rounded-2xl border border-gray-800 bg-gray-900/40 hover:bg-gray-900/60 transition"
                    >
                      <div className={`${event.color} w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white`}>
                        <span className="text-xs font-medium">{eventDate.toLocaleDateString('en-US', { month: 'short' })}</span>
                        <span className="text-lg font-bold leading-none">{eventDate.getDate()}</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-white">{event.title}</h3>
                        <p className="text-sm text-gray-500">
                          {eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-medium ${daysUntil <= 3 ? 'text-red-400' : daysUntil <= 7 ? 'text-yellow-400' : 'text-gray-400'}`}>
                          {daysUntil > 0 ? `${daysUntil} days` : daysUntil === 0 ? 'Today!' : 'Passed'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Slide 2: Analytics */}
          {currentSlide === 2 && (
            <div className="animate-in fade-in slide-in-from-right duration-500">
              <div className="flex items-center gap-3 mb-6">
                <BarChart3 className="w-6 h-6 text-emerald-400" />
                <h2 className="text-xl font-semibold text-gray-300">Today&apos;s Analytics</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 text-center">
                  <Users className="w-8 h-8 text-blue-400 mx-auto mb-3" />
                  <p className="text-4xl font-bold text-white">{attendanceStats.total}</p>
                  <p className="text-sm text-gray-500 mt-1">Total Students</p>
                </div>
                <div className="bg-gray-900/60 border border-green-500/20 rounded-2xl p-6 text-center">
                  <TrendingUp className="w-8 h-8 text-green-400 mx-auto mb-3" />
                  <p className="text-4xl font-bold text-green-400">{attendanceStats.present}</p>
                  <p className="text-sm text-gray-500 mt-1">Present</p>
                </div>
                <div className="bg-gray-900/60 border border-yellow-500/20 rounded-2xl p-6 text-center">
                  <Clock className="w-8 h-8 text-yellow-400 mx-auto mb-3" />
                  <p className="text-4xl font-bold text-yellow-400">{attendanceStats.late}</p>
                  <p className="text-sm text-gray-500 mt-1">Late</p>
                </div>
                <div className="bg-gray-900/60 border border-red-500/20 rounded-2xl p-6 text-center">
                  <GraduationCap className="w-8 h-8 text-red-400 mx-auto mb-3" />
                  <p className="text-4xl font-bold text-red-400">{attendanceStats.absent}</p>
                  <p className="text-sm text-gray-500 mt-1">Absent</p>
                </div>
              </div>
              {attendanceStats.total > 0 && (
                <div className="mt-6 bg-gray-900/60 border border-gray-800 rounded-2xl p-6">
                  <p className="text-sm text-gray-400 mb-3">Attendance Rate</p>
                  <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
                    <div 
                      className="h-full rounded-full bg-linear-to-r from-green-500 via-emerald-500 to-teal-500 transition-all duration-1000"
                      style={{ width: `${((attendanceStats.present + attendanceStats.late) / attendanceStats.total * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <p className="text-right text-sm text-gray-500 mt-2">
                    {((attendanceStats.present + attendanceStats.late) / attendanceStats.total * 100).toFixed(1)}% attendance
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Slide 3: Weather & Quick Info */}
          {currentSlide === 3 && (
            <div className="animate-in fade-in slide-in-from-right duration-500">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Weather Card */}
                <div className="bg-linear-to-br from-blue-500/20 to-cyan-500/10 border border-blue-500/20 rounded-2xl p-8">
                  <div className="flex items-center gap-3 mb-4">
                    <Cloud className="w-6 h-6 text-blue-400" />
                    <h2 className="text-lg font-semibold text-gray-300">Weather</h2>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-blue-300">
                      {getWeatherIcon()}
                    </div>
                    <div>
                      <p className="text-5xl font-bold text-white">{weather.temp}°C</p>
                      <p className="text-gray-400 mt-1">{weather.condition}</p>
                      <p className="text-sm text-gray-500">Humidity: {weather.humidity}%</p>
                    </div>
                  </div>
                </div>

                {/* Quick Tips */}
                <div className="bg-linear-to-br from-violet-500/20 to-purple-500/10 border border-violet-500/20 rounded-2xl p-8">
                  <div className="flex items-center gap-3 mb-4">
                    <Bell className="w-6 h-6 text-violet-400" />
                    <h2 className="text-lg font-semibold text-gray-300">Quick Tips</h2>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                      <p className="text-sm text-gray-400">Stand in front of the camera for automatic attendance</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                      <p className="text-sm text-gray-400">Ensure good lighting and face the camera directly</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                      <p className="text-sm text-gray-400">Attendance locks 30 minutes after class starts</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                      <p className="text-sm text-gray-400">Contact your professor for attendance summary</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Slide Indicators */}
        <div className="flex items-center gap-2 mt-8">
          {Array.from({ length: totalSlides }).map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                idx === currentSlide ? 'w-8 bg-primary' : 'w-2 bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Wake up hint */}
        <p className="text-gray-700 text-sm mt-8 animate-pulse">
          Tap anywhere or step in front of the camera to start
        </p>
      </div>
    </div>
  )
}
