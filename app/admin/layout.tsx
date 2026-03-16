import type { ReactNode } from 'react'
import PortalOfflineGuard from '@/components/portal-offline-guard'

interface AdminLayoutProps {
  children: ReactNode
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return <PortalOfflineGuard portalName="Admin">{children}</PortalOfflineGuard>
}
