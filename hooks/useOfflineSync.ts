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

    return unsubscribe
  }, [])

  return {
    ...status,
    manualSync: () => offlineSyncService.triggerSync(),
  }
}
