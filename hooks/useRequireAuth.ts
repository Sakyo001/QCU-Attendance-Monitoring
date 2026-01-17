import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { UserRole } from '@/types/database.types'

export function useRequireAuth(allowedRoles?: UserRole[]) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.push('/')
    }

    if (!loading && user && allowedRoles && !allowedRoles.includes(user.role)) {
      router.push(`/${user.role}/dashboard`)
    }
  }, [user, loading, allowedRoles, router])

  return { user, loading }
}

export function useRequireAdmin() {
  return useRequireAuth(['admin'])
}

export function useRequireProfessor() {
  return useRequireAuth(['professor'])
}

export function useRequireStudent() {
  return useRequireAuth(['student'])
}
