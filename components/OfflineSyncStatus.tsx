'use client'

import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useEffect, useState } from 'react'
import { Wifi, WifiOff, Loader2 } from 'lucide-react'

/**
 * Displays offline sync status indicator
 * Shows when syncing, online/offline status, and last sync time
 */
export function OfflineSyncStatus() {
  const { isOnline, syncInProgress, lastSyncTime } = useOfflineSync()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Don't render until client-side hydration is complete
  if (!mounted) {
    return null
  }

  if (!isOnline || syncInProgress) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <div
          className={`px-4 py-2 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 ${
            syncInProgress
              ? 'bg-blue-100 text-blue-700 border border-blue-200'
              : 'bg-amber-100 text-amber-700 border border-amber-200'
          }`}
        >
          {syncInProgress ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Syncing data...</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4" />
              <span>Offline (Cached)</span>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="px-4 py-2 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 bg-emerald-100 text-emerald-700 border border-emerald-200">
        <Wifi className="w-4 h-4" />
        <span>Online</span>
        {lastSyncTime && (
          <span className="text-xs text-emerald-600">
            (Last sync: {new Date(lastSyncTime).toLocaleTimeString()})
          </span>
        )}
      </div>
    </div>
  )
}
