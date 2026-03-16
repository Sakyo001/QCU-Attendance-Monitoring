import type { ReactNode } from 'react'
import PortalOfflineGuard from '@/components/portal-offline-guard'

interface ProfessorLayoutProps {
  children: ReactNode
}

export default function ProfessorLayout({ children }: ProfessorLayoutProps) {
  return <PortalOfflineGuard portalName="Professor">{children}</PortalOfflineGuard>
}
