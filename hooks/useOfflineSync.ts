/**
 * React hook for offline sync status monitoring
 */

'use client'

import { useEffect, useState } from 'react'
import { offlineSyncService, SyncStatus } from '@/lib/offline-sync'

export function useOfflineSync() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    syncInProgress: false,
    syncedItems: {
      professors: false,
      sections: false,
      classrooms: false,
      schedules: false,
    },
  })

  useEffect(() => {
    // Subscribe to status changes
    const unsubscribe = offlineSyncService.onStatusChange(setStatus)

    // Manually trigger sync on mount if online
    if (navigator.onLine) {
      offlineSyncService.triggerSync().catch(console.error)
    }

    // Global mutation watcher: auto-sync after successful save/delete/update API calls.
    const originalFetch = window.fetch.bind(window)
    let syncTimer: number | null = null

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args)

      try {
        const [input, init] = args
        const method = String(init?.method || 'GET').toUpperCase()
        const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'

        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

        if (response.ok && isMutation && url.includes('/api/')) {
          if (syncTimer) window.clearTimeout(syncTimer)
          syncTimer = window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('offline-sync:trigger'))
          }, 250)
        }
      } catch {
        // no-op: sync interception should never break fetch flow
      }

      return response
    }

    return () => {
      window.fetch = originalFetch
      if (syncTimer) window.clearTimeout(syncTimer)
      unsubscribe()
    }
  }, [])

  return {
    ...status,
    manualSync: () => offlineSyncService.triggerSync(),
  }
}
