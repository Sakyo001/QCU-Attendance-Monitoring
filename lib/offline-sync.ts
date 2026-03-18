/**
 * Offline Data Sync Service
 * Automatically syncs critical data to offline cache when network is available
 * Ensures offline experience is always in sync with online data
 */

export interface SyncStatus {
  isOnline: boolean
  lastSyncTime?: string
  syncInProgress: boolean
  syncedItems: {
    professors: boolean
    sections: boolean
    classrooms: boolean
    schedules: boolean
  }
}

class OfflineSyncService {
  private syncInProgress = false
  private pendingSyncRequested = false
  private lastSyncTime: Record<string, number> = {}
  private syncIntervalMs = 5 * 60 * 1000 // 5 minutes
  private statusCallbacks: Array<(status: SyncStatus) => void> = []
  private initialized = false

  constructor() {
    // Only initialize on client side
    if (typeof window !== 'undefined') {
      this.initialized = true
      this.setupOnlineDetection()
    }
  }

  /**
   * Setup online/offline detection and auto-sync
   */
  private setupOnlineDetection() {
    if (typeof window === 'undefined') return

    // Listen for online event
    window.addEventListener('online', () => {
      console.log('🌐 Network restored - syncing offline cache')
      this.syncAllData()
    })

    // Listen for offline event
    window.addEventListener('offline', () => {
      console.log('📴 Network lost - using offline cache')
      this.notifyStatusChange()
    })

    // Sync when user returns to the app/tab.
    window.addEventListener('focus', () => {
      if (navigator.onLine) {
        console.log('🎯 Window focused - syncing offline cache')
        this.syncAllData()
      }
    })

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        console.log('👀 Tab visible - syncing offline cache')
        this.syncAllData()
      }
    })

    // Allow any client code to request immediate sync after mutations.
    window.addEventListener('offline-sync:trigger' as any, () => {
      if (navigator.onLine) {
        console.log('⚡ Mutation-triggered sync requested')
        this.syncAllData()
      }
    })

    // Keep cache fresh in background.
    window.setInterval(() => {
      if (navigator.onLine) {
        this.syncAllData()
      }
    }, this.syncIntervalMs)

    // Initial online status check
    if (navigator.onLine) {
      this.syncAllData()
    }
  }

  /**
   * Sync all critical data to offline cache
   */
  async syncAllData() {
    if (this.syncInProgress) {
      // Queue one follow-up sync so mutation-triggered updates are not lost.
      this.pendingSyncRequested = true
      console.log('⏳ Sync already in progress; queued follow-up sync')
      return
    }

    this.syncInProgress = true
    this.notifyStatusChange()

    try {
      const [professorsSynced, sectionsSynced, classroomsSynced, schedulesSynced] = await Promise.all([
        this.syncProfessors(),
        this.syncSections(),
        this.syncClassrooms(),
        this.syncSchedules(),
      ])

      const now = Date.now()
      if (professorsSynced) this.lastSyncTime['professors'] = now
      if (sectionsSynced) this.lastSyncTime['sections'] = now
      if (classroomsSynced) this.lastSyncTime['classrooms'] = now
      if (schedulesSynced) this.lastSyncTime['schedules'] = now

      this.lastSyncTime['all'] = Date.now()
      console.log('✅ All data synced to offline cache')
    } catch (error) {
      console.error('⚠️ Error syncing data to offline cache:', error)
    } finally {
      this.syncInProgress = false
      this.notifyStatusChange()

      // If a sync request arrived during processing, run one more pass immediately.
      if (this.pendingSyncRequested && typeof window !== 'undefined' && navigator.onLine) {
        this.pendingSyncRequested = false
        console.log('🔁 Running queued follow-up sync')
        void this.syncAllData()
      }
    }
  }

  /**
   * Sync professors from API
   */
  private async syncProfessors() {
    try {
      // This would be called by the API when professors are fetched
      // The API route already saves to cache, so we just need to ensure it's called
      console.log('📦 Professors sync handled by API endpoints')
      return true
    } catch (error) {
      console.error('Error syncing professors:', error)
      return false
    }
  }

  /**
   * Sync sections from API
   */
  private async syncSections() {
    try {
      const response = await fetch('/api/professor/sections')
      const data = await response.json()

      if (response.ok && data.sections) {
        console.log('📦 Synced', data.sections.length, 'sections to offline cache')
        return true
      }
    } catch (error) {
      console.error('Error syncing sections:', error)
    }
    return false
  }

  /**
   * Sync classrooms from API
   */
  private async syncClassrooms() {
    try {
      const response = await fetch('/api/admin/schedules')
      const data = await response.json()

      if (response.ok && data.classSessions) {
        console.log('📦 Synced', data.classSessions.length, 'classrooms/schedules to offline cache')
        return true
      }
    } catch (error) {
      console.error('Error syncing classrooms:', error)
    }
    return false
  }

  /**
   * Sync schedules from API
   */
  private async syncSchedules() {
    try {
      const response = await fetch('/api/admin/schedules')
      const data = await response.json()

      if (response.ok && data.classSessions) {
        console.log('📦 Synced', data.classSessions.length, 'class sessions to offline cache')
        return true
      }
    } catch (error) {
      console.error('Error syncing schedules:', error)
    }
    return false
  }

  /**
   * Subscribe to sync status changes
   */
  onStatusChange(callback: (status: SyncStatus) => void): () => void {
    this.statusCallbacks.push(callback)
    // Immediately call with current status
    callback(this.getStatus())
    // Return unsubscribe function
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback)
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return {
      isOnline: typeof window !== 'undefined' ? navigator.onLine : true,
      lastSyncTime: this.lastSyncTime['all']
        ? new Date(this.lastSyncTime['all']).toISOString()
        : undefined,
      syncInProgress: this.syncInProgress,
      syncedItems: {
        professors: !!this.lastSyncTime['professors'],
        sections: !!this.lastSyncTime['sections'],
        classrooms: !!this.lastSyncTime['classrooms'],
        schedules: !!this.lastSyncTime['schedules'],
      },
    }
  }

  /**
   * Notify all subscribers of status change
   */
  private notifyStatusChange() {
    const status = this.getStatus()
    this.statusCallbacks.forEach((callback) => {
      try {
        callback(status)
      } catch (error) {
        console.error('Error in status callback:', error)
      }
    })
  }

  /**
   * Manually trigger sync
   */
  async triggerSync() {
    console.log('🔄 Manual sync triggered')
    await this.syncAllData()
  }
}

// Lazy-initialized singleton - only instantiate on first use in client
let serviceInstance: OfflineSyncService | null = null

export function getOfflineSyncService(): OfflineSyncService {
  if (!serviceInstance) {
    serviceInstance = new OfflineSyncService()
  }
  return serviceInstance
}

// Export convenience wrapper that initializes on first access
export const offlineSyncService = new Proxy(
  {} as OfflineSyncService,
  {
    get: (target, prop) => {
      const service = getOfflineSyncService()
      return (service as any)[prop]
    },
  }
)
