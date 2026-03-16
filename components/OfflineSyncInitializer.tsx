'use client'

import { useEffect } from 'react'
import { offlineSyncService } from '@/lib/offline-sync'

/**
 * Initialize offline sync service on app load
 * This component must be rendered as a child of a client component
 */
export function OfflineSyncInitializer() {
  useEffect(() => {
    console.log('🔄 Initializing offline sync service')
    
    // Service initializes itself in the constructor
    // This just ensures it's instantiated when the app loads
    
    // Manual trigger of initial sync if online
    if (navigator.onLine) {
      console.log('🌐 App loaded with network - syncing offline cache')
      offlineSyncService.triggerSync().catch(error => {
        console.error('Initial sync failed:', error)
      })
    } else {
      console.log('📴 App loaded without network - using offline cache')
    }
  }, [])

  return null
}
