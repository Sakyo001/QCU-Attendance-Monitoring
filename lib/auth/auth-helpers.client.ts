'use client'

import { createClient } from '@/utils/supabase/client'
import { LoginCredentials, SignUpData } from '@/types/auth.types'
import { mapDbUserToAuthUser } from './utils'
import { AuthUser } from '@/types/auth.types'

// Client-side: Sign in with email and password (server-side endpoint for RLS bypass)
export async function signInWithEmail(credentials: LoginCredentials) {
  try {
    console.log('signInWithEmail: Starting login request')
    
    // Use server endpoint that bypasses RLS with service role key
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    })

    console.log('signInWithEmail: Response received', response.status)

    if (!response.ok) {
      const errorData = await response.json()
      console.error('signInWithEmail: Error response', errorData)
      return { user: null, error: new Error(errorData.error || 'Login failed') }
    }

    const dbUser = await response.json()
    console.log('signInWithEmail: User data received', dbUser)
    
    const mappedUser = mapDbUserToAuthUser(dbUser)
    console.log('signInWithEmail: User mapped', mappedUser)
    
    return { user: mappedUser, error: null }
  } catch (err) {
    console.error('signInWithEmail: Exception caught', err)
    return { user: null, error: new Error('An error occurred during login') }
  }
}

// Client-side: Sign up new user
export async function signUpWithEmail(data: SignUpData) {
  const supabase = createClient()
  
  // Create user record in database directly
  const { data: dbUser, error: dbError } = await (supabase as any)
    .from('users')
    .insert({
      email: data.email,
      password: data.password,
      role: data.role || 'student',
      first_name: data.firstName,
      last_name: data.lastName,
      employee_id: data.employeeId,
      student_id: data.studentId,
      is_active: true,
    } as any)
    .select()
    .single()

  if (dbError) {
    return { user: null, error: dbError }
  }

  return { user: mapDbUserToAuthUser(dbUser), error: null }
}

// Client-side: Sign out
export async function signOut() {
  try {
    // Clear localStorage
    localStorage.removeItem('authUser')
    console.log('Sign out: Cleared localStorage')
  } catch (error) {
    console.error('Error during sign out:', error)
  }
}

// Check if user has role
export function hasRole(user: AuthUser | null, roles: string[]): boolean {
  return user !== null && roles.includes(user.role)
}

// Check if user is admin
export function isAdmin(user: AuthUser | null): boolean {
  return hasRole(user, ['admin'])
}

// Check if user is professor
export function isProfessor(user: AuthUser | null): boolean {
  return hasRole(user, ['professor'])
}

// Check if user is student
export function isStudent(user: AuthUser | null): boolean {
  return hasRole(user, ['student'])
}
