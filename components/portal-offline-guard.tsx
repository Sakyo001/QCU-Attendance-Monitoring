'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { WifiOff } from 'lucide-react'

type PortalName = 'Admin' | 'Professor'

interface PortalOfflineGuardProps {
  portalName: PortalName
  children: ReactNode
}

export default function PortalOfflineGuard({ portalName, children }: PortalOfflineGuardProps) {
  const [mounted, setMounted] = useState(false)
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    setMounted(true)
    const updateOnline = () => setIsOnline(navigator.onLine)
    updateOnline()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  if (!mounted) {
    return <>{children}</>
  }

  if (!isOnline) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <section className="max-w-md w-full bg-white rounded-xl shadow-lg border border-gray-200 p-6 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <WifiOff className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">{portalName} Portal Unavailable Offline</h1>
          <p className="mt-2 text-sm text-gray-600">
            This portal requires internet connection. Offline mode is only available for kiosk attendance.
          </p>
          <div className="mt-6 flex gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              Go to Kiosk
            </Link>
          </div>
        </section>
      </main>
    )
  }

  return <>{children}</>
}
