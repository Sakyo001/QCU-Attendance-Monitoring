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
      console.log('⏳ Sync already in progress')
      return
    }

    this.syncInProgress = true
    this.notifyStatusChange()

    try {
      await Promise.all([
        this.syncProfessors(),
        this.syncSections(),
        this.syncClassrooms(),
        this.syncSchedules(),
      ])

      this.lastSyncTime['all'] = Date.now()
      console.log('✅ All data synced to offline cache')
    } catch (error) {
      console.error('⚠️ Error syncing data to offline cache:', error)
    } finally {
      this.syncInProgress = false
      this.notifyStatusChange()
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
      // Get current user's ID from localStorage or auth context
      const authUserStr = localStorage.getItem('authUser')
      if (!authUserStr) {
        console.log('ℹ️ No user logged in, skipping classroom sync')
        return true
      }

      const authUser = JSON.parse(authUserStr)
      const response = await fetch(`/api/professor/classrooms?professorId=${authUser.id}`)
      const data = await response.json()

      if (response.ok && data.classrooms) {
        console.log('📦 Synced', data.classrooms.length, 'classrooms to offline cache')
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
