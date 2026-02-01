'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { UserRole } from '@/types/database.types'

interface RouteGuardProps {
  children: React.ReactNode
  allowedRoles: UserRole[]
  redirectTo?: string
}

export function RouteGuard({ children, allowedRoles, redirectTo }: RouteGuardProps) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading) {
      if (!user) {
        // Not authenticated, redirect to home or specified path
        router.push(redirectTo || '/')
      } else if (!allowedRoles.includes(user.role)) {
        // User doesn't have required role, redirect to their dashboard
        router.push(`/${user.role}/dashboard`)
      }
    }
  }, [user, loading, allowedRoles, redirectTo, router])

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600"></div>
      </div>
    )
  }

  // Show nothing while redirecting
  if (!user || !allowedRoles.includes(user.role)) {
    return null
  }

  return <>{children}</>
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard allowedRoles={['admin']} redirectTo="/login">
      {children}
    </RouteGuard>
  )
}

export function ProfessorGuard({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard allowedRoles={['professor']} redirectTo="/login">
      {children}
    </RouteGuard>
  )
}

export function StudentGuard({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard allowedRoles={['student']} redirectTo="/login">
      {children}
    </RouteGuard>
  )
}

export function AdminOrProfessorGuard({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard allowedRoles={['admin', 'professor']}>
      {children}
    </RouteGuard>
  )
}
