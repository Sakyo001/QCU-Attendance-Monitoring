'use server'

import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { UserRole } from '@/types/database.types'
import { AuthUser } from '@/types/auth.types'
import { mapDbUserToAuthUser } from './utils'

// Get current authenticated user (server-side only)
export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)
  
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !authUser) {
    return null
  }

  // Fetch user details from database
  const { data: dbUser, error: dbError } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', authUser.id)
    .single()

  if (dbError || !dbUser) {
    return null
  }

  // Update last login
  await supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', dbUser.id)

  return mapDbUserToAuthUser(dbUser)
}

// Check if user has required role (server-side only)
export async function requireRole(allowedRoles: UserRole[]): Promise<AuthUser | null> {
  const user = await getCurrentUser()
  
  if (!user || !allowedRoles.includes(user.role)) {
    return null
  }
  
  return user
}

// Check if user is admin (server-side only)
export async function requireAdmin(): Promise<AuthUser | null> {
  return requireRole(['admin'])
}

// Check if user is professor (server-side only)
export async function requireProfessor(): Promise<AuthUser | null> {
  return requireRole(['professor'])
}

// Check if user is student (server-side only)
export async function requireStudent(): Promise<AuthUser | null> {
  return requireRole(['student'])
}
